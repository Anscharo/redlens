/// <reference lib="webworker" />
import lunr from "lunr";
import type { AtlasNode, AddressInfo, SearchHit, WorkerInMessage, WorkerOutMessage } from "../types";

declare const self: DedicatedWorkerGlobalScope;

let idx: lunr.Index | null = null;
let docs: Record<string, AtlasNode> = {};

// Address reverse-lookup structures, built at init from addresses.json + docs.
// chainlogId  → lowercase address  (e.g. "MCD_VAT" → "0x35d1…")
// address     → node ids that reference it via addressRefs
const chainlogToAddr: Map<string, string> = new Map();
const addrToNodeIds: Map<string, string[]> = new Map();

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

  // Wrap matched terms in <mark>, extending to cover the full word (not just the stem)
  const valid = matchedTerms.filter(t => t.length >= 2);
  if (valid.length > 0) {
    const pattern = valid
      .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\w*")
      .join("|");
    excerpt = excerpt.replace(new RegExp(pattern, "gi"), "<mark>$&</mark>");
  }

  return excerpt;
}

function highlightTerms(text: string, terms: string[]): string {
  const valid = terms.filter(t => t.length >= 2);
  if (valid.length === 0) return text.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  let result = text.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  // Single-pass replacement to avoid matching inside <mark> tags
  const pattern = valid
    .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\w*")
    .join("|");
  result = result.replace(new RegExp(pattern, "gi"), "<mark>$&</mark>");
  return result;
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

function docToHit(doc: AtlasNode, score = 1, snippet?: string, terms: string[] = [], matchReason = ""): SearchHit {
  return {
    id: doc.id,
    score,
    doc_no: doc.doc_no,
    title: doc.title,
    titleHtml: terms.length > 0 ? highlightTerms(doc.title, terms) : doc.title.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!)),
    matchReason,
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

  // Extract in:DOCNUMBER scope filter before other processing
  const IN_RE = /\bin:(\S+)/gi;
  let inPrefix: string | null = null;
  const qWithoutIn = q.replace(IN_RE, (_, prefix: string) => {
    inPrefix = prefix.toUpperCase();
    return ' ';
  }).trim();

  // Extract type:"quoted multi-word value" before lunr — lunr has no quoted field syntax.
  // Stored as a post-filter; the entire token is removed from the lunr query.
  const TYPE_QUOTED_RE = /\btype:"([^"]+)"/gi;
  const qForPhrases = qWithoutIn.replace(TYPE_QUOTED_RE, () => ' ').trim();

  const { phrases, rest } = extractPhrases(qForPhrases);

  // Chainlog reverse-map results — collected into a scored map first so they
  // can be merged with lunr results below. Chainlog hits get score 2 so they
  // surface above typical lunr scores but can be outranked by a very strong
  // lunr match on the same node.
  const chainlogHits = new Map<string, SearchHit>();
  let matchedChainlogId: string | undefined;
  let matchedChainlogAddr: string | undefined;
  if (CHAINLOG_RE.test(trimmed)) {
    const addr = chainlogToAddr.get(trimmed);
    if (addr) {
      matchedChainlogId = trimmed;
      matchedChainlogAddr = addr;
      for (const id of addrToNodeIds.get(addr) ?? []) {
        const doc = docs[id];
        if (doc) {
          const hit = docToHit(doc, 2, undefined, [], "chainlog");
          hit.chainlogId = trimmed;
          hit.chainlogAddress = addr;
          chainlogHits.set(id, hit);
        }
      }
    }
  }

  // A bare hex-prefix query ("0x", "0x35d1", partial address) won't match
  // anything in lunr as-is because it has no trailing wildcard. Auto-append *
  // so the user doesn't have to remember to type it.
  const HEX_PREFIX_RE = /^0x[0-9a-fA-F]*$/i;

  // Token tickers (all-caps, 3-8 chars like SUSDS, USDC, MKR, stUSDS) get
  // mangled by lunr's stemmer — "SUSDS" stems to match "sUSDe". Treat them
  // as implicit exact phrases so the post-filter requires a literal substring.
  const TICKER_RE = /^[a-z]{0,2}[A-Z]{2,}[0-9]*$/;
  const restWords = rest.trim().split(/\s+/).filter(Boolean);
  for (const word of restWords) {
    const bare = word.replace(/^[+\-~]/, "").replace(/[~^*]\d*$/, "");
    if (bare.length >= 3 && bare.length <= 8 && TICKER_RE.test(bare) && !phrases.includes(bare)) {
      phrases.push(bare);
    }
  }

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

    // Phrase post-filter: every quoted phrase must literally appear in title or content.
    if (phrases.length > 0) {
      const lowerContent = doc.content.toLowerCase();
      const lowerTitle = doc.title.toLowerCase();
      for (const p of phrases) {
        const lp = p.toLowerCase();
        if (!lowerContent.includes(lp) && !lowerTitle.includes(lp)) return null;
      }
    }

    // Include both stemmed terms (from lunr metadata) and original query words
    // so highlighting covers cases where stemming diverges (e.g. "sky" → "ski")
    const queryWords = rest.trim().split(/\s+/).filter(Boolean);
    const matchedTerms = [...new Set([...Object.keys(r.matchData.metadata), ...queryWords, ...phrases])];

    // Build match reason from which fields each term matched in
    const fieldSet = new Set<string>();
    const meta = r.matchData.metadata as Record<string, Record<string, unknown>>;
    for (const fields of Object.values(meta)) {
      for (const f of Object.keys(fields)) fieldSet.add(f);
    }
    const parts: string[] = [];
    if (fieldSet.has("title")) parts.push("title");
    if (fieldSet.has("doc_no")) parts.push("doc number");
    if (fieldSet.has("type")) parts.push("type");
    if (fieldSet.has("content")) parts.push("content");
    if (phrases.length > 0) parts.push("exact phrase");
    const matchReason = parts.join(" + ");

    return {
      id: doc.id,
      score: r.score,
      doc_no: doc.doc_no,
      title: doc.title,
      titleHtml: highlightTerms(doc.title, matchedTerms),
      matchReason,
      type: doc.type,
      depth: doc.depth,
      parentId: doc.parentId,
      snippet: buildSnippet(doc.content, matchedTerms),
    } satisfies SearchHit;
  }).filter((h): h is SearchHit => h !== null);

  // Apply in:DOCNUMBER scope filter if present
  const scopedLunrHits = inPrefix
    ? lunrHits.filter(h => h.doc_no === inPrefix || h.doc_no.startsWith(inPrefix + "."))
    : lunrHits;

  // Merge with three tiers:
  //   1. found by BOTH chainlog + lunr  (best snippet from lunr, highest priority)
  //   2. chainlog only
  //   3. lunr only  (sorted by lunr score)
  if (chainlogHits.size === 0) return scopedLunrHits;

  const lunrById = new Map(scopedLunrHits.map((h) => [h.id, h]));

  const both: SearchHit[] = [];
  const chainlogOnly: SearchHit[] = [];
  for (const [id, chainlogHit] of chainlogHits) {
    const lunrHit = lunrById.get(id);
    if (lunrHit) {
      // Use lunr's snippet (has highlights) but carry chainlog info
      both.push({ ...lunrHit, score: lunrHit.score, matchReason: "chainlog + " + lunrHit.matchReason, chainlogId: matchedChainlogId, chainlogAddress: matchedChainlogAddr });
    } else {
      chainlogOnly.push(chainlogHit);
    }
  }
  const lunrOnly = scopedLunrHits.filter((h) => !chainlogHits.has(h.id));

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
