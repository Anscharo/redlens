// Search: lexical (minisearch, in-memory) + semantic (pgvector) + RRF merge.
// Both legs return id+rank+score; callers resolve full nodes from the doc map.
import { type Indexes } from "./indexes.ts";
import { sql, toVectorLiteral } from "../db.ts";
import { embedQuery } from "./embed.ts";
import { config } from "../config.ts";
import { compactProse } from "../../lib/shortenTitle.ts";

const RRF_K = 60;

// Race a promise against a timeout, clearing the timer either way. Used to bound
// the query-time embed so a slow provider can't hang the retrieve path.
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let tid: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    tid = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(tid));
}

export interface Hit {
  id: string;
  rank: number;
  score: number;
  source: "lexical" | "semantic";
}

// `skipped` carries a short reason when the semantic leg failed at RUNTIME
// (embed timeout, provider error, pgvector error) — callers surface it to the
// chat harness so degraded retrieval is visible instead of vanishing into a
// console.warn. A missing OPENROUTER_API_KEY is a permanent config state, not
// degradation, so it reports `skipped: null` (else every keyless dev result
// would carry a "skipped" note).
export interface SemanticResult {
  hits: Hit[];
  skipped: string | null;
}

export interface MergedHit {
  id: string;
  sources: string[];
  rrf_score: number;
  score: number;
}

// Match the frontend lexical search (src/workers/search.worker.ts): prefix on,
// fuzzy OFF by default (it dilutes exact term/ID/address lookups — the strength
// of lexical mode), same boosts and OR combine.
export function runLexical(ix: Indexes, query: string, type: string | undefined, k: number): Hit[] {
  let results = ix.mini.search(query, {
    boost: { title: 10, doc_no: 5, type: 2 },
    prefix: true,
    fuzzy: false,
    combineWith: "OR",
  });
  // Type is a POST-filter against docMap, not a MiniSearch `filter`: the index
  // stores no per-result fields (kept out to shrink the artifact), so results
  // carry no `type`. Resolve it by id — same approach as the frontend worker.
  // Filter before slicing to k so the cap counts only type-matching hits.
  if (type) results = results.filter((r) => ix.docMap.get(r.id as string)?.type === type);
  return results.slice(0, k).map((r, i) => ({ id: r.id as string, rank: i, score: r.score, source: "lexical" }));
}

export async function runSemantic(
  _ix: Indexes,
  query: string,
  type: string | undefined,
  k: number,
): Promise<SemanticResult> {
  if (!config.openrouterApiKey) return { hits: [], skipped: null }; // no key → permanent config state, not degradation
  // Bound the embed: on timeout or provider failure, degrade to lexical-only
  // instead of hanging the whole retrieve (embedBatch's backoff can reach ~15s,
  // which blew the e2e atlas_query timeout). Lexical hits still answer the query.
  // The AbortController makes the timeout real — it cancels the in-flight fetch +
  // retry loop, not just the wrapper promise, so a slow provider doesn't leave
  // background embed work piling up per query.
  //
  // The try covers the embed AND the pgvector query: either can fail at
  // runtime, and both must degrade to lexical-only with a reported reason
  // instead of throwing into the caller (a bare pgvector error used to escape
  // uncaught, silently swallowed by the caller's own `.catch(() => [])`).
  const ac = new AbortController();
  try {
    const vec = await withTimeout(embedQuery(query, ac.signal), config.semanticEmbedTimeoutMs, "embed");
    const lit = toVectorLiteral(vec);
    const overFetch = type ? Math.min(k * 4, 200) : k;
    const rows = (await sql.unsafe(
      `SELECT m.id, m.type, 1 - (e.embedding <=> $1::vector) AS score
       FROM atlas_doc_embeddings e JOIN atlas_doc_meta m ON m.id = e.doc_id
       ORDER BY e.embedding <=> $1::vector LIMIT $2`,
      [lit, overFetch],
    )) as { id: string; type: string; score: number }[];

    const out: Hit[] = [];
    for (const r of rows) {
      // Rows are ordered by ascending distance (descending cosine), so once one
      // falls below the relevance floor, every later row does too — stop.
      if (r.score < config.semanticMinScore) break;
      if (type && r.type !== type) continue;
      out.push({ id: r.id, rank: out.length, score: r.score, source: "semantic" });
      if (out.length >= k) break;
    }
    return { hits: out, skipped: null };
  } catch (err) {
    ac.abort(); // no-op if the failure was past the embed stage
    const reason = (err as Error).message;
    console.warn(`  semantic leg skipped: ${reason}`);
    return { hits: [], skipped: reason };
  }
}

export function rrfMerge(lex: Hit[], sem: Hit[]): MergedHit[] {
  const acc = new Map<string, MergedHit>();
  const bump = (h: Hit) => {
    const inc = 1 / (RRF_K + h.rank + 1);
    const prev = acc.get(h.id);
    if (prev) {
      prev.rrf_score += inc;
      if (!prev.sources.includes(h.source)) prev.sources.push(h.source);
    } else {
      acc.set(h.id, { id: h.id, sources: [h.source], rrf_score: inc, score: h.score });
    }
  };
  for (const h of lex) bump(h);
  for (const h of sem) bump(h);
  return [...acc.values()].sort((a, b) => b.rrf_score - a.rrf_score);
}

// Substring snippet around the first matched query term (minisearch gives no
// FTS5-style snippet). Falls back to the head of the content.
export function buildSnippet(content: string, query: string, len = 240): string {
  if (!content) return "";
  const terms = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const lc = content.toLowerCase();
  let at = -1;
  for (const t of terms) {
    if (t.length < 2) continue;
    const i = lc.indexOf(t);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  // Pull a WIDER raw window, then compact it (drop articles, abbreviate known
  // words) so the returned snippet carries more content per `len` bytes than a
  // hard char-truncation would. Compaction happens after slicing so the match
  // position stays accurate.
  const raw = Math.round(len * 1.6);
  const start = at < 0 ? 0 : Math.max(0, at - raw / 4);
  let text = compactProse(content.slice(start, start + raw).trim());
  if (text.length > len) text = text.slice(0, len).trimEnd();
  const lead = start > 0;
  const trail = start + raw < content.length;
  return (lead ? "…" : "") + text + (trail ? "…" : "");
}

// The agent-facing counterpart of buildSnippet: same idea, but the text is
// VERBATIM — no word is dropped, abbreviated, or reordered. The two exist
// separately because their audiences want opposite things. A human scanning a
// result list wants density, which is what buildSnippet's compaction buys. An
// agent needs text it can quote, cite, and be graded on: the system prompt
// requires identifiers and quotes to be copied from tool results, and the
// verifier machine-checks quotes against those results.
//
// The 2026-08-04 bakeoff measured what compaction costs an agent. Models quoted
// `Comms.` and `Info.` — strings that appear nowhere in the atlas — straight to
// users. Models that restored the stripped stopwords produced quotes matching no
// evidence and were hard-failed as ungrounded, which in production forces a
// full-transcript recovery replay. And dropping `of`/`for`/`to` silently changes
// claims: "responsible for the Agent" → "responsible Agent".
//
// Only whitespace RUNS collapse, which the verifier's `normalizeForMatch`
// applies to both sides anyway, so a faithful quote still matches.
export function buildAgentSnippet(content: string, query: string, len = 240): string {
  if (!content) return "";
  const terms = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const lc = content.toLowerCase();
  let at = -1;
  for (const t of terms) {
    if (t.length < 2) continue;
    const i = lc.indexOf(t);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  // Open a quarter-length before the hit so it keeps context on both sides, then
  // pull both ends back to word boundaries. A snippet that starts or ends
  // mid-word is unquotable — which did not matter when the window was being
  // rewritten anyway, and does now. The lead search is bounded so a long
  // unbroken run (an address, a URL) can't swallow the whole window.
  let start = at < 0 ? 0 : Math.max(0, Math.round(at - len / 4));
  if (start > 0) {
    const sp = content.indexOf(" ", start);
    if (sp !== -1 && sp - start < 40) start = sp + 1;
  }
  let end = Math.min(content.length, start + len);
  if (end < content.length) {
    const sp = content.lastIndexOf(" ", end);
    if (sp > start) end = sp;
  }
  const text = content.slice(start, end).replace(/\s+/g, " ").trim();
  return (start > 0 ? "…" : "") + text + (end < content.length ? "…" : "");
}

// Phrase parsing is shared with the frontend reader (one source of truth):
// "double" → case-insensitive phrase, 'single' → case-sensitive phrase.
export { extractPhrases } from "../../lib/searchHighlight.ts";

// Exact-phrase post-filter shared by atlas_search + atlas_query: a doc must
// contain every case-insensitive phrase and every case-sensitive phrase.
export function matchesPhrases(title: string, content: string, phrases: string[], casePhrases: string[]): boolean {
  const hay = `${title}\n${content}`;
  const hayLower = hay.toLowerCase();
  return phrases.every((p) => hayLower.includes(p.toLowerCase())) && casePhrases.every((p) => hay.includes(p));
}
