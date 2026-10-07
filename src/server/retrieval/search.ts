// Search: lexical (minisearch, in-memory) + semantic (pgvector) + RRF merge.
// Both legs return id+rank+score; callers resolve full nodes from the doc map.
import { type Indexes } from "./indexes.ts";
import { withTimeout } from "../retry.ts";
import { sql, toVectorLiteral } from "../db.ts";
import { embedQueries, type EmbedDiag } from "./embed.ts";
import { config } from "../config.ts";
import { MINISEARCH_SEARCH_OPTIONS } from "../../lib/searchOptions.ts";
import { compactProse } from "../../lib/shortenTitle.ts";
import { type Via } from "./embed-units.ts";
import { expandQueryTokens, partitionByOriginalTerms } from "../../lib/searchInflect.ts";
import { rrfFuse } from "../../lib/searchSemantic.ts";
import { fuseBriefings, runBriefings, SCOPED_SCAN_SETTING, semanticScopeSql, unitHits } from "./briefings.ts";
export { fuseBriefings, SCOPED_SCAN_SETTING, semanticScopeSql } from "./briefings.ts";
export type { Via };
export { withTimeout };

export interface Hit {
  id: string;
  rank: number;
  score: number;
  source: "lexical" | "semantic" | "briefing";
  memberIds?: string[];
  via?: Via;
}

// `skipped` carries a short reason when the semantic leg failed at RUNTIME
// (embed timeout, provider error, pgvector error) — callers surface it to the
// chat harness so degraded retrieval is visible instead of vanishing into a
// console.warn. A missing OPENROUTER_API_KEY is a permanent config state, not
// degradation, so it reports `skipped: null` (else every keyless dev result
// would carry a "skipped" note).
export interface SemanticResult {
  hits: Hit[];
  /**
   * Nearest briefing vectors (`atlas_doc_briefings`), best first, from the same
   * query vector as `hits`. Always present: `[]` when the leg is skipped, when
   * no document has an embedded briefing yet, or when this statement failed on
   * its own (a failure here leaves `hits` untouched). Document ids, not groups,
   * so there is nothing to attribute; fuse with `fuseBriefings` (reader) or
   * pass to `rrfMerge` (chat).
   */
  briefingHits: Hit[];
  skipped: string | null;
  /**
   * The vectors this leg embedded, handed back so leaf attribution can reuse
   * them instead of paying its own round trip. `residual` is present only when
   * the caller asked for one. Absent on any degraded or skipped leg — which is
   * exactly when attribution should fall back to the lexical pick.
   */
  vecs?: { query: number[]; residual?: number[] };
}

export interface MergedHit {
  id: string;
  sources: string[];
  rrf_score: number;
  score: number;
  via?: Via;
}

// Match the frontend lexical search (apps/web/src/workers/search.worker.ts): prefix on,
// fuzzy OFF by default (it dilutes exact term/ID/address lookups — the strength
// of lexical mode), same boosts and OR combine.
export function runLexical(ix: Indexes, query: string, type: string | undefined, k: number): Hit[] {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  const expansion = expandQueryTokens(tokens);
  const q = expansion.extra.length > 0 ? `${query} ${expansion.extra.join(" ")}` : query;
  let results = ix.mini.search(q, {
    ...MINISEARCH_SEARCH_OPTIONS, boost: { title: 10, doc_no: 5, type: 2 },
    prefix: true, fuzzy: false,
    combineWith: "OR",
  });
  if (expansion.extra.length > 0) {
    results = partitionByOriginalTerms(results, new Set(expansion.originals));
  }
  // Type is a POST-filter against docMap, not a MiniSearch `filter`: the index
  // stores no per-result fields (kept out to shrink the artifact), so results
  // carry no `type`. Resolve it by id — same approach as the frontend worker.
  // Filter before slicing to k so the cap counts only type-matching hits.
  if (type) results = results.filter((r) => ix.docMap.get(r.id as string)?.type === type);
  return results.slice(0, k).map((r, i) => ({ id: r.id as string, rank: i, score: r.score, source: "lexical" }));
}

/**
 * What to report when an embed fails, preferring the PROVIDER's own words.
 *
 * `withTimeout` reports the stopwatch, which is what the race saw, not what
 * went wrong: the retry backoff outlives the timeout, so a 403 or a 429 reaches
 * the user as "embed timed out after 10000ms". When the provider said
 * something, say that too — it is the difference between a reader knowing the
 * key is wrong and a reader thinking the internet is slow.
 */
export function embedFailureReason(err: unknown, diag: EmbedDiag): string {
  const raced = err instanceof Error ? err.message : String(err);
  if (!diag.lastError || diag.lastError === raced) return raced;
  // Bounded: this lands in a one-line status under the search box, and the
  // provider's body is already capped at 300 chars upstream.
  const cause = diag.lastError.length > 140 ? `${diag.lastError.slice(0, 140)}…` : diag.lastError;
  return `${raced} — provider said: ${cause}`;
}

export async function runSemantic(
  _ix: Indexes,
  query: string,
  type: string | undefined,
  k: number,
  /**
   * An `in:` doc-number subtree to restrict retrieval to. Pushed into the SQL
   * rather than applied afterwards: post-filtering a k-sized nearest-neighbour
   * list returns whatever of it happens to fall in the subtree, which for a
   * narrow scope is usually nothing. Deliberately PERMISSIVE — it also keeps
   * anchors ABOVE the scope, because a grouped anchor is an ancestor of its
   * members and carries the leaves inside it. The exact test runs after
   * attribution; see `anchorCouldServeScope`.
   */
  scope?: string,
  /**
   * A second text to embed IN THE SAME ROUND TRIP as the query — the residual
   * leaf attribution scores group members against (see `lexicalResidual`). It is
   * embedded here rather than by `buildLeafScorer` because the cost of an embed
   * is the round trip and not the payload (two texts measure ~2.3s p50, the same
   * as one), so a residual computed AFTER this call costs a second 2.3s — half
   * the request — for a vector that could have ridden along.
   */
  residualText?: string,
): Promise<SemanticResult> {
  if (!config.openrouterApiKey) return { hits: [], briefingHits: [], skipped: null }; // no key → permanent config state, not degradation
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
  const diag: EmbedDiag = {};
  try {
    const wanted = residualText && residualText !== query ? [query, residualText] : [query];
    const embedded = await withTimeout(
      embedQueries(wanted, ac.signal, diag),
      config.semanticEmbedTimeoutMs,
      "embed",
    );
    const vec = embedded[0]!;
    // The residual is the query itself when nothing was left to strip; reuse the
    // one vector rather than sending the same text twice.
    const residualVec = residualText ? (embedded[1] ?? vec) : undefined;
    const lit = toVectorLiteral(vec);
    const overFetch = type ? Math.min(k * 4, 200) : k;
    // NOT attribution_only: folded members keep a vector purely so an already
    // retrieved group can be attributed to the right leaf (migration 023). They must
    // not compete in search itself, or the grouping they were folded out of is undone.
    const stmt = `SELECT m.id, m.type, e.member_ids, 1 - (e.embedding <=> $1::vector) AS score
       FROM atlas_doc_embeddings e JOIN atlas_doc_meta m ON m.id = e.doc_id
       WHERE NOT e.attribution_only${semanticScopeSql(scope)}
       ORDER BY e.embedding <=> $1::vector LIMIT $2`;
    const rows = (
      scope
        ? await sql.begin(async (tx) => {
            await tx.unsafe(SCOPED_SCAN_SETTING);
            return tx.unsafe(stmt, [lit, overFetch, scope]);
          })
        : await sql.unsafe(stmt, [lit, overFetch])
    ) as { id: string; type: string; score: number; member_ids?: unknown }[];
    const out = unitHits(rows, overFetch);
    const briefingHits = await runBriefings(lit, Math.max(overFetch, 50), scope);
    return { hits: out, briefingHits, skipped: null, vecs: { query: vec, ...(residualVec ? { residual: residualVec } : {}) } };
  } catch (err) {
    ac.abort(); // no-op if the failure was past the embed stage
    const reason = embedFailureReason(err, diag);
    console.warn(`  semantic leg skipped: ${reason}`);
    return { hits: [], briefingHits: [], skipped: reason };
  }
}

// Fusion itself lives in lib/searchSemantic.ts `rrfFuse`, so there is one
// implementation of it rather than a second copy here. This wrapper only
// carries the per-hit metadata RRF has no opinion about (which legs found it,
// the raw score, the grouped-anchor provenance).
// `briefings` is a third list in the SAME rrfFuse call: one RRF stage, never a
// fusion of a fusion. Measured on the whole corpus (`--hybrid
// --briefings none,s2docs --pool all`, 179 queries, exact recall@10): +4.5
// [1.7, 7.8] on questions, +3.4 [0.6, 6.7] on keywords. Smaller than the semantic
// lane's gain because the lexical list already finds most of what the briefings
// add, and MRR falls (0.626 → 0.582 on questions).
export function rrfMerge(lex: Hit[], sem: Hit[], briefings: Hit[] = []): MergedHit[] {
  const lists = [lex.map((h) => h.id), sem.map((h) => h.id)];
  if (briefings.length > 0) lists.push(briefings.map((h) => h.id));
  const fused = rrfFuse(lists);
  const acc = new Map<string, MergedHit>();
  for (const h of [...lex, ...sem, ...briefings]) {
    const prev = acc.get(h.id);
    if (prev) {
      if (!prev.sources.includes(h.source)) prev.sources.push(h.source);
      if (h.via && !prev.via) prev.via = h.via;
    } else {
      acc.set(h.id, { id: h.id, sources: [h.source], rrf_score: fused.get(h.id) ?? 0, score: h.score, via: h.via });
    }
  }
  return [...acc.values()].sort((a, b) => b.rrf_score - a.rrf_score);
}

// The merge `atlas_search` runs for each mode. `semantic` is the measured arm
// exactly: attributed leaves fused once with the briefing ranking, no lexical
// list (docs/plans/atlas-doc-briefings.md). `hybrid` is the three-way fusion
// (lexical, attributed semantic, briefings); its measured gain is in the
// comment at `rrfMerge`.
export function mergeForMode(mode: "lexical" | "semantic" | "hybrid", lex: Hit[], sem: Hit[], briefings: Hit[]): MergedHit[] {
  if (mode === "lexical") return lex.map((h) => ({ id: h.id, sources: ["lexical"], rrf_score: 0, score: h.score }));
  if (mode === "hybrid") return rrfMerge(lex, sem, briefings);
  return fuseBriefings(sem, briefings).map((h) => ({ id: h.id, sources: [h.source], rrf_score: 0, score: h.score, via: h.via }));
}

// Type / phrase filters run AFTER leaf-pick so a quoted leaf value is not
// dropped because the semantic row still had the parent id / parent type.
export function filterByType<T extends { id: string }>(hits: T[], ix: Indexes, type: string | undefined): T[] {
  if (!type) return hits;
  return hits.filter((h) => ix.docMap.get(h.id)?.type === type);
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
