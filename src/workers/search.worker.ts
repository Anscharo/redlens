/// <reference lib="webworker" />
import lunr from "lunr";
import type { AtlasNode, SearchHit, WorkerInMessage, WorkerOutMessage } from "../types";

declare const self: DedicatedWorkerGlobalScope;

let idx: lunr.Index | null = null;
let docs: Record<string, AtlasNode> = {};

async function init() {
  const base = import.meta.env.BASE_URL;
  const [idxRes, docsRes] = await Promise.all([
    fetch(`${base}search-index.json`),
    fetch(`${base}docs.json`),
  ]);
  const [idxData, docsData] = await Promise.all([
    idxRes.json() as Promise<object>,
    docsRes.json() as Promise<Record<string, AtlasNode>>,
  ]);
  idx = lunr.Index.load(idxData);
  docs = docsData;
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
    // escape for regex
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    excerpt = excerpt.replace(new RegExp(escaped, "gi"), "<mark>$&</mark>");
  }

  return excerpt;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function search(q: string): SearchHit[] {
  if (!idx) return [];

  // Direct UUID lookup — bypass Lunr entirely
  if (UUID_RE.test(q.trim())) {
    const doc = docs[q.trim().toLowerCase()];
    if (doc) {
      return [{
        id: doc.id,
        score: 1,
        doc_no: doc.doc_no,
        title: doc.title,
        type: doc.type,
        depth: doc.depth,
        parentId: doc.parentId,
        snippet: doc.content.slice(0, 160) + (doc.content.length > 160 ? "…" : ""),
      }];
    }
    return [];
  }

  const { phrases, rest } = extractPhrases(q);

  let results: lunr.Index.Result[];
  try {
    results = idx.search(rest);
  } catch {
    // lunr throws on bad query syntax — fall back to wildcard search
    try {
      results = idx.search(rest.split(/\s+/).filter(Boolean).map(t => `${t}*`).join(" "));
    } catch {
      return [];
    }
  }

  return results.map((r) => {
    const doc = docs[r.ref];
    if (!doc) return null;

    // Phrase post-filter: every quoted phrase must literally appear in the content.
    if (phrases.length > 0) {
      const lower = doc.content.toLowerCase();
      for (const p of phrases) {
        if (!lower.includes(p.toLowerCase())) return null;
      }
    }

    // Collect the unique stemmed terms that matched, plus phrases for highlighting.
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
