/// <reference lib="webworker" />
import MiniSearch from "minisearch";
import type {
  AtlasNode,
  AddressInfo,
  SearchHit,
  WorkerInMessage,
  WorkerOutMessage,
} from "@/types";
import { fetchText } from "@/lib/verify";
import { buildSnippet, highlightTerms } from "@/lib/searchHighlight";
import { UUID_RE } from "@/lib/patterns";
import { isUuidPrefix, matchUuidPrefix } from "../lib/uuidSearch";
import { CHAINLOG_RE, cancelSemanticLeg } from "./searchSemanticLeg";
import { parseQuery, type ParsedQuery } from "./searchQuery";
import { mergeChainlog, toHits, type ChainlogMatch, type MiniResult } from "./searchHits";
import { docFilterFor, type DocFilter } from "./searchFilter";
import { docNoKey } from "@/lib/docNo";
import { answerQuery, createLexicalMemo, hydrateSemantic, type QueryDeps } from "./searchWorkerLanes";
import { MINISEARCH_OPTIONS, MINISEARCH_SEARCH_OPTIONS } from "@/lib/searchOptions";
import { expandQueryTokens, partitionByOriginalTerms } from "@/lib/searchInflect";
import { computeLabels } from "../lib/hitLabels";

declare const self: DedicatedWorkerGlobalScope;

let idx: MiniSearch | null = null;
let docs: Record<string, AtlasNode> = {};

// Address reverse-lookup structures, built at init from addresses.json + docs.
// chainlogId  → lowercase address  (e.g. "MCD_VAT" → "0x35d1…")
// address     → node ids that reference it via addressRefs
const chainlogToAddr: Map<string, string> = new Map();
const addrToNodeIds: Map<string, string[]> = new Map();

// Exact doc_no → node for fast direct-navigation lookups
const byDocNo: Map<string, AtlasNode> = new Map();

// Resolved by the "preload" message from the main thread, which forwards
// already-loaded atlas + address data so this worker doesn't fetch them again.
let resolvePreload!: (data: { docs: Record<string, AtlasNode>; addresses: Record<string, AddressInfo> }) => void;
const preloadPromise = new Promise<{ docs: Record<string, AtlasNode>; addresses: Record<string, AddressInfo> }>(
  (res) => { resolvePreload = res; },
);

async function init() {
  // Preview passes its bundle base via the worker `name` (e.g. /api/preview/<sha>/)
  // so the search index matches the preview docs; default is the live atlas.
  const base = self.name || import.meta.env.BASE_URL;
  const [idxText, { docs: preloadedDocs, addresses: preloadedAddrs }] = await Promise.all([
    fetchText(`${base}search-index.json`, "search-index.json"),
    preloadPromise,
  ]);

  idx = MiniSearch.loadJSON(idxText, MINISEARCH_OPTIONS);
  docs = preloadedDocs;

  for (const [addr, info] of Object.entries(preloadedAddrs)) {
    if (info.chainlogId) chainlogToAddr.set(info.chainlogId, addr);
  }

  for (const [id, doc] of Object.entries(docs)) {
    byDocNo.set(doc.doc_no, doc);
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

// The SearchHit fields every lane derives the same way from a doc.
function hitFor(doc: AtlasNode, score: number, titleHtml: string, matchReason: string, snippet: string): SearchHit {
  const { id, doc_no, title, type, depth, parentId } = doc;
  const labels = computeLabels(doc, byDocNo);
  return { id, score, doc_no, title, titleHtml, matchReason, type, depth, parentId, labels, snippet };
}

function docToHit(
  doc: AtlasNode,
  score = 1,
  snippet?: string,
  terms: string[] = [],
  matchReason = "",
): SearchHit {
  return hitFor(
    doc,
    score,
    highlightTerms(doc.title, terms),
    matchReason,
    snippet ?? doc.content.slice(0, 160) + (doc.content.length > 160 ? "…" : ""),
  );
}

function search(q: string): SearchHit[] {
  if (!idx) return [];

  const trimmed = q.trim();
  const exact = exactLookup(trimmed);
  if (exact) return exact;

  const parsed = parseQuery(q);
  const chainlog = chainlogLookup(trimmed);

  // When query is a known chainlog ID, require it literally in text-matched results.
  // Without this, MiniSearch splits "MCD_VAT" → ["MCD","VAT"] and prefix-matches
  // every node containing "MCD_JUG", "advocate", etc.
  if (chainlog && !parsed.casePhrases.includes(chainlog.id)) {
    parsed.casePhrases.push(chainlog.id);
  }

  const results = runIndex(idx, parsed, docFilterFor(parsed, docs));
  const hits = toHits(results, parsed, docs, hitFor);
  if (!chainlog || chainlog.hits.size === 0) return hits;
  return mergeChainlog(hits, chainlog);
}

// The exact fast paths. null falls through to full-text search.
function exactLookup(trimmed: string): SearchHit[] | null {
  // Direct UUID lookup — bypass MiniSearch entirely
  if (UUID_RE.test(trimmed)) {
    const doc = docs[trimmed.toLowerCase()];
    return doc ? [docToHit(doc)] : [];
  }

  // Partial UUID prefix lookup — paste a UUID fragment (e.g. the 8-hex first
  // segment) and jump to the doc. The id field isn't in the MiniSearch index,
  // so scan ids directly. Falls through to full-text when nothing matches, so a
  // hex-ish word that isn't a real UUID prefix still searches content.
  if (isUuidPrefix(trimmed)) {
    const ids = matchUuidPrefix(trimmed, Object.keys(docs));
    if (ids.length) {
      return ids
        .map((id) => docs[id])
        .sort((a, b) => a.doc_no.localeCompare(b.doc_no, undefined, { numeric: true }))
        .map((d) => docToHit(d, 9, undefined, [], "uuid prefix"));
    }
  }

  // Exact doc_no fast-path — e.g. "A.1.2", "1.2" or "NR-12". Falls through to
  // full-text when no such doc exists.
  const docNoHit = byDocNo.get(docNoKey(trimmed) ?? "");
  return docNoHit ? [docToHit(docNoHit, 10, undefined, [trimmed], "doc number")] : null;
}

// Chainlog reverse-map — collected into a scored map to merge with search results
function chainlogLookup(trimmed: string): ChainlogMatch | null {
  if (!CHAINLOG_RE.test(trimmed)) return null;
  const addr = chainlogToAddr.get(trimmed);
  if (!addr) return null;
  const hits = new Map<string, SearchHit>();
  for (const id of addrToNodeIds.get(addr) ?? []) {
    const doc = docs[id];
    if (doc) {
      const snippet = buildSnippet(doc.content, [addr], [], []);
      const hit = docToHit(doc, 2, snippet, [], "chainlog");
      hit.chainlogId = trimmed;
      hit.chainlogAddress = addr;
      hits.set(id, hit);
    }
  }
  return { id: trimmed, addr, hits };
}

function runIndex(index: MiniSearch, p: ParsedQuery, docFilter: DocFilter | undefined): MiniResult[] {
  const { finalQuery } = p;
  // A query with no indexable token (e.g. a bare "_") can only be answered by
  // the literal phrase filter, so scan instead of asking MiniSearch.
  const queryEmpty = !/[\p{L}\p{N}]{2}/u.test(finalQuery) && (!finalQuery || p.phrases.length + p.casePhrases.length > 0);

  if (queryEmpty) {
    const filter = docFilter ?? (() => true);
    return Object.keys(docs)
      .filter((id) => filter({ id }))
      .map((id) => ({ id, score: 1, terms: [], queryTerms: [], match: {} }));
  }
  const expansion = expandQueryTokens(finalQuery.split(/\s+/).filter(Boolean));
  const searchQuery = expansion.extra.length > 0 ? `${finalQuery} ${expansion.extra.join(" ")}` : finalQuery;
  const results = index.search(searchQuery, {
    ...MINISEARCH_SEARCH_OPTIONS, prefix: true,
    fuzzy: p.fuzzyLevel || false,
    boost: { title: 10, doc_no: 5, type: 2 },
    combineWith: "OR",
    ...(docFilter ? { filter: docFilter } : {}),
  }) as MiniResult[];
  return expansion.extra.length > 0 ? partitionByOriginalTerms(results, new Set(expansion.originals)) : results;
}

// ─── semantic lane ──────────────────────────────────────────────────────────
//
// The lane's decisions and fusion live in searchSemanticLeg.ts and the rest in
// searchWorkerLanes.ts. What stays here is only the binding to this worker's
// state: GET /api/search/semantic returns ids and cosine scores, and this worker
// holds the corpus plus every function that turns a document into a rendered
// hit, so hydration is wired here and nowhere else, or docs.json and the
// highlighting would need a second copy.
const queryDeps: QueryDeps = {
  index: () => idx,
  search,
  lexicalFor: createLexicalMemo(search),
  // matchReason stays empty on purpose: it is what the result row renders as a
  // bare semantic mark, with no "+ <lexical reason>" beside it.
  hydrate: (scored) => hydrateSemantic(scored, docs, (doc, score, snippet) => docToHit(doc, score, snippet, [], "")),
  knowsChainlog: (id) => chainlogToAddr.has(id),
  post,
};

self.addEventListener("message", (e: MessageEvent<WorkerInMessage>) => {
  const msg = e.data;
  if (msg.type === "preload") {
    resolvePreload({ docs: msg.docs, addresses: msg.addresses });
    return;
  }
  if (msg.type === "ping") {
    post({ type: "ready" });
    return;
  }
  if (msg.type === "query") {
    cancelSemanticLeg();
    answerQuery(msg, queryDeps);
  }
});

init().catch((err) => {
  // Surface the failure to the main thread — a silent catch leaves useSearch
  // in "loading" forever (the graph/atlas workers post the same way).
  post({ type: "error", message: String(err) });
});
