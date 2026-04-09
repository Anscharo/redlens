/// <reference lib="webworker" />
import lunr from "lunr";
import type { AtlasNode, AddressInfo, SearchHit, WorkerInMessage, WorkerOutMessage } from "../types";

declare const self: DedicatedWorkerGlobalScope;

let idx: lunr.Index | null = null;
let docs: Record<string, AtlasNode> = {};

// Address reverse-lookup structures, built at init from addresses.json + docs.
// chainlogId  → lowercase address  (e.g. "MCD_VAT" → "0x35d1…")
// address     → node ids that reference it via addressRefs
let chainlogToAddr: Map<string, string> = new Map();
let addrToNodeIds: Map<string, string[]> = new Map();

async function init() {
  const base = import.meta.env.BASE_URL;
  const [idxRes, docsRes, addrsRes] = await Promise.all([
    fetch(`${base}search-index.json`),
    fetch(`${base}docs.json`),
    fetch(`${base}addresses.json`),
  ]);
  const [idxData, docsData, addrsData] = await Promise.all([
    idxRes.json() as Promise<object>,
    docsRes.json() as Promise<Record<string, AtlasNode>>,
    addrsRes.json() as Promise<Record<string, AddressInfo>>,
  ]);

  idx = lunr.Index.load(idxData);
  docs = docsData;

  // Build chainlogId → address map
  for (const [addr, info] of Object.entries(addrsData)) {
    if (info.chainlogId) chainlogToAddr.set(info.chainlogId, addr);
  }

  // Build address → node ids reverse map from docs addressRefs
  for (const [id, doc] of Object.entries(docs)) {
    for (const ref of doc.addressRefs ?? []) {
      const list = addrToNodeIds.get(ref);
      if (list) list.push(id);
      else addrToNodeIds.set(ref, [id]);
    }
  }

  post({ type: "ready" });
}

function post(msg: WorkerOutMessage) {
  self.postMessage(msg);
}

// Build a plain-text snippet around the best match in `content`.
// Returns a string with <mark> tags around matched terms.
function buildSnippet(content: string, matchedTerms: string[]): string {
  if (!content || matchedTerms.length === 0) return "";

  const WINDOW = 160; // chars of context to show
  const lower = content.toLowerCase();

  // Find the earliest match position
  let bestPos = -1;
  for (const term of matchedTerms) {
    const pos = lower.indexOf(term.toLowerCase());
    if (pos !== -1 && (bestPos === -1 || pos < bestPos)) bestPos = pos;
  }

  if (bestPos === -1) return content.slice(0, WINDOW) + "…";

  const start = Math.max(0, bestPos - 60);
  const end = Math.min(content.length, start + WINDOW);
  let excerpt = (start > 0 ? "…" : "") + content.slice(start, end) + (end < content.length ? "…" : "");

  // Wrap matched terms in <mark>
  for (const term of matchedTerms) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    excerpt = excerpt.replace(new RegExp(escaped, "gi"), "<mark>$&</mark>");
  }

  return excerpt;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Chainlog IDs are ALL_CAPS_WITH_UNDERSCORES, at least 3 chars, starting with a letter.
const CHAINLOG_RE = /^[A-Z][A-Z0-9_]{2,}$/;

// Extract quoted "phrases" from a query and return them along with the
// query stripped of quotes. Lunr has no native phrase operator, so we
// post-filter results by literal substring match.
function extractPhrases(q: string): { phrases: string[]; rest: string } {
  const phrases: string[] = [];
  const rest = q.replace(/"([^"]+)"/g, (_, p: string) => {
    const trimmed = p.trim();
    if (trimmed) phrases.push(trimmed);
    return ` ${p} `;
  });
  return { phrases, rest };
}

function docToHit(doc: AtlasNode, score = 1, snippet?: string): SearchHit {
  return {
    id: doc.id,
    score,
    doc_no: doc.doc_no,
    title: doc.title,
    type: doc.type,
    depth: doc.depth,
    parentId: doc.parentId,
    snippet: snippet ?? (doc.content.slice(0, 160) + (doc.content.length > 160 ? "…" : "")),
  };
}

function search(q: string): SearchHit[] {
  if (!idx) return [];

  const trimmed = q.trim();

  // Direct UUID lookup — bypass Lunr entirely
  if (UUID_RE.test(trimmed)) {
    const doc = docs[trimmed.toLowerCase()];
    return doc ? [docToHit(doc)] : [];
  }

  const { phrases, rest } = extractPhrases(q);

  // Chainlog reverse-map results — collected into a scored map first so they
  // can be merged with lunr results below. Chainlog hits get score 2 so they
  // surface above typical lunr scores but can be outranked by a very strong
  // lunr match on the same node.
  const chainlogHits = new Map<string, SearchHit>();
  if (CHAINLOG_RE.test(trimmed)) {
    const addr = chainlogToAddr.get(trimmed);
    if (addr) {
      for (const id of addrToNodeIds.get(addr) ?? []) {
        const doc = docs[id];
        if (doc) chainlogHits.set(id, docToHit(doc, 2));
      }
    }
  }

  // A bare hex-prefix query ("0x", "0x35d1", partial address) won't match
  // anything in lunr as-is because it has no trailing wildcard. Auto-append *
  // so the user doesn't have to remember to type it.
  const HEX_PREFIX_RE = /^0x[0-9a-fA-F]*$/i;
  const normalized = HEX_PREFIX_RE.test(rest.trim())
    ? rest.trim() + "*"
    : rest;

  let results: lunr.Index.Result[];
  try {
    results = idx.search(normalized);
  } catch {
    // lunr throws on bad query syntax — fall back to wildcard search
    try {
      results = idx.search(normalized.split(/\s+/).filter(Boolean).map(t => `${t}*`).join(" "));
    } catch {
      return [];
    }
  }

  const lunrHits = results.map((r) => {
    const doc = docs[r.ref];
    if (!doc) return null;

    // Phrase post-filter: every quoted phrase must literally appear in the content.
    if (phrases.length > 0) {
      const lower = doc.content.toLowerCase();
      for (const p of phrases) {
        if (!lower.includes(p.toLowerCase())) return null;
      }
    }

    const matchedTerms = [...Object.keys(r.matchData.metadata), ...phrases];

    return {
      id: doc.id,
      score: r.score,
      doc_no: doc.doc_no,
      title: doc.title,
      type: doc.type,
      depth: doc.depth,
      parentId: doc.parentId,
      snippet: buildSnippet(doc.content, matchedTerms),
    } satisfies SearchHit;
  }).filter((h): h is SearchHit => h !== null);

  // Merge with three tiers:
  //   1. found by BOTH chainlog + lunr  (best snippet from lunr, highest priority)
  //   2. chainlog only
  //   3. lunr only  (sorted by lunr score)
  if (chainlogHits.size === 0) return lunrHits;

  const lunrById = new Map(lunrHits.map((h) => [h.id, h]));

  const both: SearchHit[] = [];
  const chainlogOnly: SearchHit[] = [];
  for (const [id, chainlogHit] of chainlogHits) {
    const lunrHit = lunrById.get(id);
    if (lunrHit) {
      // Use lunr's snippet (has highlights) but keep chainlog's tier
      both.push({ ...lunrHit, score: lunrHit.score });
    } else {
      chainlogOnly.push(chainlogHit);
    }
  }
  const lunrOnly = lunrHits.filter((h) => !chainlogHits.has(h.id));

  both.sort((a, b) => b.score - a.score);
  lunrOnly.sort((a, b) => b.score - a.score);

  return [...both, ...chainlogOnly, ...lunrOnly];
}

self.addEventListener("message", (e: MessageEvent<WorkerInMessage>) => {
  const msg = e.data;
  if (msg.type === "ping") {
    post({ type: "ready" });
    return;
  }
  if (msg.type === "query") {
    const t0 = performance.now();
    const hits = search(msg.q);
    post({ type: "results", id: msg.id, hits, durationMs: performance.now() - t0 });
  }
});

init().catch((err) => {
  console.error("Search worker init failed:", err);
});
