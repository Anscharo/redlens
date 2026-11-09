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
import { docNoKey } from "@/lib/docNo";
import { answerQuery, createLexicalMemo, hydrateSemantic, type QueryDeps } from "./searchWorkerLanes";
import { MINISEARCH_OPTIONS, MINISEARCH_SEARCH_OPTIONS } from "@/lib/searchOptions";
import { counterpartTerm, expandQueryTokens, partitionByOriginalTerms } from "@/lib/searchInflect";
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

  const results = runIndex(idx, parsed, docFilterFor(parsed));
  const hits = toHits(results, parsed);
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

interface ChainlogMatch {
  id: string;
  addr: string;
  hits: Map<string, SearchHit>;
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

// field:term regexes — case-insensitive; doc_no uses simple includes.
// Broad `title:subsidy` also accepts the singular/plural counterpart.
function fieldTermRegexes(fieldScopedTerms: Map<string, string[]>): Map<string, RegExp[]> {
  return new Map<string, RegExp[]>(
    [...fieldScopedTerms.entries()].map(([f, terms]) => [
      f,
      terms.map((t) => {
        const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const other = counterpartTerm(t);
        const body = other ? `(?:${esc(t)}|${esc(other)})` : esc(t);
        return new RegExp("\\b" + body + "\\b", "i");
      }),
    ]),
  );
}

type DocFilter = (result: { id: unknown }) => boolean;

// Single filter function passed to MiniSearch (and applied to the queryEmpty path).
// Handles: type:, in:, field:term, phrase, case-phrase, and -exclusion.
function docFilterFor(p: ParsedQuery): DocFilter | undefined {
  const { typeFilters, inPrefix, casePhrases, excludeTerms } = p;
  // Pre-compile once per search (not once per document). Phrase / case-phrase
  // matching is a literal substring test — no \b anchors — per the documented
  // "quoted phrase = literal substring" contract; a \b-anchored regex can never
  // match a phrase that begins or ends with punctuation (e.g. "(USDS)"), since
  // \b never holds between two non-word characters. See searchHighlight.ts for
  // the (boundary-aware, for readable highlighting) highlight-side counterpart.
  const lowerPhrases = p.phrases.map((ph) => ph.toLowerCase());
  const fieldTermRes = fieldTermRegexes(p.fieldScopedTerms);
  const hasFilters =
    typeFilters.length > 0 ||
    inPrefix !== null ||
    fieldTermRes.size > 0 ||
    lowerPhrases.length > 0 ||
    casePhrases.length > 0 ||
    excludeTerms.length > 0;
  if (!hasFilters) return undefined;

  return (result) => {
    const doc = docs[result.id as string];
    if (!doc) return false;
    if (typeFilters.length > 0 && !typeFilters.includes(doc.type.toLowerCase())) return false;
    if (inPrefix && doc.doc_no !== inPrefix && !doc.doc_no.startsWith(inPrefix + ".")) return false;
    for (const [field, res] of fieldTermRes) {
      const text = field === "title" ? doc.title : field === "content" ? doc.content : doc.doc_no;
      if (res.some((re) => !re.test(text))) return false;
    }
    if (lowerPhrases.length > 0) {
      const contentLower = doc.content.toLowerCase();
      const titleLower = doc.title.toLowerCase();
      if (lowerPhrases.some((ph) => !contentLower.includes(ph) && !titleLower.includes(ph))) return false;
    }
    if (casePhrases.some((ph) => !doc.content.includes(ph) && !doc.title.includes(ph))) return false;
    if (excludeTerms.length > 0) {
      const haystack = (doc.title + " " + doc.content).toLowerCase();
      if (excludeTerms.some((t) => haystack.includes(t))) return false;
    }
    return true;
  };
}

type MiniResult = { id: unknown; score: number; terms: string[]; queryTerms: string[]; match: Record<string, string[]> };

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

function highlightTermsFor(p: ParsedQuery): { title: string[]; content: string[] } {
  // Use original query words for highlighting (not stems)
  // Exclude words that came from phrases — the phrase highlight covers them.
  // Without this, "Delegated" from 'Delegated Signers' leaks into terms and
  // highlights "delegatedSigners" case-insensitively via the \w* extension.
  const phraseWordSet = new Set(
    [...p.phrases, ...p.casePhrases].flatMap((ph) => ph.toLowerCase().split(/\s+/)),
  );
  const queryWords = p.finalQuery
    .trim()
    .split(/\s+/)
    .filter((w) => w && !phraseWordSet.has(w.toLowerCase()));

  // title: and content: scoped terms only highlight in their own field.
  // doc_no: and unscoped terms are treated as free (highlight everywhere).
  const fieldTitle = p.fieldScopedTerms.get("title") ?? [];
  const fieldContent = p.fieldScopedTerms.get("content") ?? [];
  const strictFieldTerms = new Set([...fieldTitle, ...fieldContent].map((w) => w.toLowerCase()));
  const freeWords = queryWords.filter((w) => !strictFieldTerms.has(w.toLowerCase()));
  const inflectedFree = expandQueryTokens(freeWords).extra;
  const counterparts = (terms: string[]) => terms.flatMap((t) => {
    const other = counterpartTerm(t);
    return other ? [other] : [];
  });
  return {
    title: [...fieldTitle, ...counterparts(fieldTitle), ...freeWords, ...inflectedFree],
    content: [...fieldContent, ...counterparts(fieldContent), ...freeWords, ...inflectedFree],
  };
}

// Build matchReason from MiniSearch match object: { term: [field, ...] }
function matchReasonFor(match: Record<string, string[]>, p: ParsedQuery): string {
  const fieldSet = new Set<string>();
  for (const fields of Object.values(match)) {
    for (const f of fields) fieldSet.add(f);
  }
  const scoped = p.fieldScopedTerms;
  const parts: string[] = [];
  if (p.typeFilters.length > 0) parts.push("type");
  if (fieldSet.has("title") || scoped.has("title")) parts.push("title");
  if (fieldSet.has("doc_no") || scoped.has("doc_no")) parts.push("doc number");
  if (fieldSet.has("content") || scoped.has("content")) parts.push("content");
  if (p.phrases.length > 0 || p.casePhrases.length > 0) parts.push("exact phrase");
  return parts.join(" + ");
}

function toHits(results: MiniResult[], p: ParsedQuery): SearchHit[] {
  const terms = highlightTermsFor(p);
  return results
    .map((r): SearchHit | null => {
      const doc = docs[r.id as string];
      if (!doc) return null;
      return hitFor(
        doc,
        r.score,
        highlightTerms(doc.title, terms.title, p.phrases, p.casePhrases),
        matchReasonFor(r.match, p),
        buildSnippet(doc.content, terms.content, p.phrases, p.casePhrases),
      );
    })
    .filter((h): h is SearchHit => h !== null);
}

// Merge with three tiers:
//   1. found by BOTH chainlog + search  (best snippet from search, highest priority)
//   2. chainlog only
//   3. search only  (sorted by score)
function mergeChainlog(hits: SearchHit[], chainlog: ChainlogMatch): SearchHit[] {
  const hitsById = new Map(hits.map((h) => [h.id, h]));

  const both: SearchHit[] = [];
  const chainlogOnly: SearchHit[] = [];
  for (const [id, chainlogHit] of chainlog.hits) {
    const hit = hitsById.get(id);
    if (hit) {
      both.push({
        ...hit,
        matchReason: "chainlog + " + hit.matchReason,
        chainlogId: chainlog.id,
        chainlogAddress: chainlog.addr,
      });
    } else {
      chainlogOnly.push(chainlogHit);
    }
  }
  const searchOnly = hits.filter((h: SearchHit) => !chainlog.hits.has(h.id));

  both.sort((a, b) => b.score - a.score);
  searchOnly.sort((a, b) => b.score - a.score);

  return [...both, ...chainlogOnly, ...searchOnly];
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
