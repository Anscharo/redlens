// Search: lexical (minisearch, in-memory) + semantic (pgvector) + RRF merge.
// Both legs return id+rank+score; callers resolve full nodes from the doc map.
import { type Indexes } from "./indexes.ts";
import { sql, toVectorLiteral, toUuidArrayLiteral } from "../db.ts";
import { fromUuidArray } from "../pg-array.ts";
import { embedQueries, type EmbedDiag } from "./embed.ts";
import { config } from "../config.ts";
import { compactProse } from "../../lib/shortenTitle.ts";
import { rewriteSemanticHit, type Via, type LeafSemanticScore, fuseLeafScores, type LeafRow } from "./embed-units.ts";
import { expandQueryTokens, partitionByOriginalTerms } from "../../lib/searchInflect.ts";
import { rrfFuse } from "../../lib/searchSemantic.ts";
export type { Via };

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
    boost: { title: 10, doc_no: 5, type: 2 },
    prefix: true,
    fuzzy: false,
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
   * is the round trip and not the payload (measured 2026-09-30: two texts ~2.3s
   * p50, the same as one), so a residual computed AFTER this call cost a second
   * 2.3s — half the request — for a vector that could have ridden along.
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

    const out: Hit[] = [];
    for (const r of rows) {
      // Rows are ordered by ascending distance (descending cosine), so once one
      // falls below the relevance floor, every later row does too — stop.
      if (r.score < config.semanticMinScore) break;
      // Do not type-filter here: a grouped parent may have a different type
      // from the leaf we rewrite to. Callers filter after attributeSemanticHits.
      const memberIds = fromUuidArray(r.member_ids);
      out.push({
        id: r.id,
        rank: out.length,
        score: r.score,
        source: "semantic",
        memberIds: memberIds.length > 0 ? memberIds : undefined,
      });
      if (out.length >= overFetch) break;
    }
    const briefingHits = await runBriefings(lit, Math.max(overFetch, 50), scope);
    return { hits: out, briefingHits, skipped: null, vecs: { query: vec, ...(residualVec ? { residual: residualVec } : {}) } };
  } catch (err) {
    ac.abort(); // no-op if the failure was past the embed stage
    const reason = embedFailureReason(err, diag);
    console.warn(`  semantic leg skipped: ${reason}`);
    return { hits: [], briefingHits: [], skipped: reason };
  }
}

/**
 * The briefing statement: nearest embedded briefings to the query vector the
 * unit statement already used. Its own try/catch, because a missing table or a
 * bad index must cost the reader the briefing list and nothing else — the unit
 * hits are already in hand.
 *
 * WHERE must stay `b.embedding IS NOT NULL` plus the scope clause: that is the
 * predicate of the partial index `atlas_doc_briefings_hnsw` (migration 037), and
 * a different one stops the planner using it, the same tie the unit query has to
 * migration 024.
 *
 * NO `semanticMinScore` floor. The eval that measured the gain applied none, and
 * cosines against briefing text are not calibrated against the 0.3 the unit
 * leg uses; the fusion ranks by position, so a weak tail costs little.
 *
 * A scoped query runs in its own transaction under the same `SET LOCAL
 * enable_indexscan = off` as the unit statement, for the same reason. It is a
 * second transaction rather than the unit statement's, because an error inside
 * one aborts it and would take the unit rows down with it.
 */
async function runBriefings(lit: string, limit: number, scope: string | undefined): Promise<Hit[]> {
  try {
    const stmt = `SELECT b.doc_id AS id, 1 - (b.embedding <=> $1::vector) AS score
       FROM atlas_doc_briefings b JOIN atlas_doc_meta m ON m.id = b.doc_id
       WHERE b.embedding IS NOT NULL${semanticScopeSql(scope)}
       ORDER BY b.embedding <=> $1::vector LIMIT $2`;
    const rows = (
      scope
        ? await sql.begin(async (tx) => {
            await tx.unsafe(SCOPED_SCAN_SETTING);
            return tx.unsafe(stmt, [lit, limit, scope]);
          })
        : await sql.unsafe(stmt, [lit, limit])
    ) as { id: string; score: number }[];
    return rows.map((r, i) => ({ id: r.id, rank: i, score: Number(r.score), source: "briefing" }));
  } catch (err) {
    console.warn(`  briefing leg skipped: ${(err as Error).message}`);
    return [];
  }
}

// Fusion itself lives in lib/searchSemantic.ts `rrfFuse`, so there is one
// implementation of it rather than a second copy here. This wrapper only
// carries the per-hit metadata RRF has no opinion about (which legs found it,
// the raw score, the grouped-anchor provenance).
/**
 * The `AND …` fragment restricting retrieval to an `in:` doc-number subtree,
 * or "" when there is no scope. Split out so its shape is assertable without a
 * database — the clause is the SQL twin of `anchorCouldServeScope`, and the two
 * must keep saying the same thing:
 *   · the anchor IS the scope                       (m.doc_no = $3)
 *   · the anchor is INSIDE it                       (m.doc_no LIKE $3 || '.%')
 *   · the anchor is an ANCESTOR of it, so it may    ($3 LIKE m.doc_no || '.%')
 *     hold members inside it
 * Every comparison appends the dot, so `A.2` cannot match `A.22`. `$3` is bound
 * by the caller; the scope string is never interpolated into the statement.
 */
/**
 * Planner setting a SCOPED query runs under, inside its own transaction.
 *
 * An HNSW index scan is approximate in a way that breaks a filtered query: it
 * walks the graph for `hnsw.ef_search` (default 40) nearest candidates and
 * Postgres applies the WHERE clause to THOSE, so `in:A.6` with LIMIT 40
 * returned 3 rows — the 3 of the 40 globally nearest anchors that happened to
 * sit under A.6 (measured 2026-09-29 with EXPLAIN ANALYZE: index scan 38 rows,
 * 3 survive the join). Every scope narrower than the whole atlas is hit, and
 * the wider the scope the more it looks like it worked.
 *
 * Disabling the index scan for the statement forces an exact pass over every
 * searchable vector: 6,810 anchors × 1,024 dims measured at 50 ms, against 11 ms
 * for the broken indexed plan. Chosen over pgvector 0.8's
 * `hnsw.iterative_scan = relaxed_order` (40 rows in 40 ms) because it is exact,
 * needs no pgvector version, and a scoped query is the rare case — the
 * unscoped statement keeps the index untouched. `SET LOCAL` dies with the
 * transaction, so no other statement on the pooled connection inherits it.
 */
export const SCOPED_SCAN_SETTING = "SET LOCAL enable_indexscan = off";

export function semanticScopeSql(scope: string | undefined): string {
  if (!scope) return "";
  // Both sides upper-cased, like `inScope` — the twin this clause has to keep
  // agreeing with. Three doc numbers in the current atlas end in a lowercase
  // `.var1` (Scenario Variations), so comparing a caller's upper-cased scope
  // against a raw `m.doc_no` made `in:A.1.5.5.0.4.1.1.1.var1` match nothing at
  // all and the lane answer an empty list with no reason given. `upper($3)`
  // rather than trusting the caller: the SQL cannot see that invariant, and it
  // costs nothing here — a scoped statement already runs without the index.
  return " AND (upper(m.doc_no) = upper($3) OR upper(m.doc_no) LIKE upper($3) || '.%' OR upper($3) LIKE upper(m.doc_no) || '.%')";
}

// `briefings` is a third list in the SAME rrfFuse call: one RRF stage, never a
// fusion of a fusion. Measured 2026-10-01 on the whole corpus (`--hybrid
// --briefings none,s2docs --pool all`, 179 queries, exact recall@10): +4.5
// [1.7, 7.8] on questions, +3.4 [0.6, 6.7] on keywords. Smaller than the semantic
// lane's gain because the lexical list already finds most of what the briefings
// add, and MRR falls (0.626 → 0.582 on questions).
/**
 * The reader's fusion: the attributed leaf list and the briefing list, by rank,
 * once. Measured on qwen3-embedding-8b over 179 queries (docs/plans/
 * atlas-doc-briefings.md): exact recall@10 +12.3 [7.8, 17.3] on the pilot pool
 * and +10.6 [5.6, 15.6] on the half-corpus pool for question-shaped queries,
 * +8.4 [4.5, 12.3] for keyword-shaped ones. 20 to 22 queries gained, 0 to 1
 * lost. Prepending the briefing to the document's own text gained nothing, and
 * a second ranking over unit anchors only gained +2.8, so the briefing is its
 * own vector.
 *
 * Output is ordered by fused score, ties by the leaf list's order. Each hit
 * keeps its own cosine as `score` and prefers the leaf's `via`. An id in both
 * lists stays a "semantic" hit with the leaf's score; a briefing-only id is a
 * "briefing" hit. With no briefings the leaves come back as they were.
 */
export function fuseBriefings(leaves: Hit[], briefings: Hit[]): Hit[] {
  if (briefings.length === 0) return leaves;
  const fused = rrfFuse([leaves.map((h) => h.id), briefings.map((h) => h.id)]);
  const byId = new Map<string, Hit>();
  for (const h of leaves) if (!byId.has(h.id)) byId.set(h.id, h);
  for (const h of briefings) if (!byId.has(h.id)) byId.set(h.id, h);
  return [...byId.values()]
    .sort((a, b) => (fused.get(b.id) ?? 0) - (fused.get(a.id) ?? 0))
    .map((h, i) => ({ ...h, rank: i }));
}

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

// Number of retrieved anchor titles whose words are stripped to build the residual
// query. Measured 2026-08-18 (scripts/aux/leaf-attribution-experiment.ts): attribution
// accuracy rises 40% (top-1) -> 50% (top-10) -> 51% (top-20) and falls back to 46% by
// top-50 as genuine question words start being stripped. 20 is the measured peak.
const RESIDUAL_ANCHOR_K = 20;

// The question minus the words the retrieved groups already account for.
//
// A query names the thing it is about ("… Ethereum Mainnet - Fluid sUSDS ERC4626
// Vault …"), and that long name dominates the embedding: members win by echoing the
// instance name rather than by answering the question, so the anchor itself and
// same-named values outrank the member that holds the answer. INSIDE a group the
// instance name discriminates nothing. Stripping the union of the top-K anchor titles
// leaves the part that actually chooses between members.
export function residualQuery(query: string, anchorTitles: string[]): string {
  const strip = new Set<string>();
  for (const t of anchorTitles) for (const w of t.toLowerCase().match(/[a-z0-9]+/g) ?? []) strip.add(w);
  const kept = (query.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => !strip.has(w));
  // Everything stripped => nothing left to discriminate on; keep the original.
  return kept.length ? kept.join(" ") : query;
}

// Attribute grouped semantic hits to a leaf (term overlap) and fuse a
// parent/child pair onto the more specific id before RRF, so lexical child +
// semantic parent become one hit.
export function attributeSemanticHits(
  query: string,
  lex: Hit[],
  sem: Hit[],
  ix: Indexes,
  semantic?: LeafSemanticScore,
): Hit[] {
  const lexNos = lex.map((h) => {
    const n = ix.docMap.get(h.id);
    return { id: h.id, doc_no: n?.doc_no ?? "" };
  });
  return sem.map((h) => {
    const rw = rewriteSemanticHit(query, h.id, h.memberIds, lexNos, ix.docMap, semantic);
    return { ...h, id: rw.id, via: rw.via };
  });
}

/**
 * The residual text to score group members against, built from the LEXICAL leg.
 *
 * Inside a group the instance name discriminates nothing — every member carries
 * it — so the question minus those words is what picks the leaf. That rule is
 * load-bearing: measured 2026-09-30 over 98 queries whose target is folded into
 * a group, scoring members against the plain query vector instead of a residual
 * collapses ICD disambiguation from 62.5% to 2.5%, worse than no semantic
 * attribution at all.
 *
 * The titles come from the lexical leg rather than the semantic one, and that is
 * the whole latency fix: `runLexical` is in-memory MiniSearch, so its titles
 * exist BEFORE the embed, which lets the residual ride in the query's own round
 * trip. Stripping the semantic leg's titles needs its results first, which is a
 * second 2.3s round trip — half the request.
 */
export function lexicalResidual(query: string, lex: Hit[], docMap: Indexes["docMap"]): string {
  const titles = lex
    .slice(0, RESIDUAL_ANCHOR_K)
    .map((h) => docMap.get(h.id)?.title)
    .filter((t): t is string => !!t);
  return residualQuery(query, titles);
}

/**
 * Score group members so `pickLeaf` can choose one, using only vectors the
 * request already has — see `fuseLeafScores` for the rule and its measurement.
 *
 * Best-effort by design: no vectors, no DB, or fewer than two scorable members
 * returns undefined and attribution falls back to the lexical pick. It no longer
 * embeds anything, so it can no longer time out.
 */
export async function buildLeafScorer(
  sem: Hit[],
  vecs: SemanticResult["vecs"],
): Promise<LeafSemanticScore | undefined> {
  if (!vecs?.residual) return undefined;
  const grouped = sem.filter((h) => (h.memberIds?.length ?? 0) > 1);
  if (grouped.length === 0) return undefined;
  // member → its anchor, so the group-echo term and the ranks are per group. A
  // member belongs to one group (embed-units folds it once), so first wins.
  const anchorOf = new Map<string, string>();
  for (const h of grouped) for (const id of h.memberIds ?? []) if (!anchorOf.has(id)) anchorOf.set(id, h.id);
  if (anchorOf.size === 0) return undefined;
  const members = [...anchorOf.keys()];
  try {
    const rows = (await sql.unsafe(
      // One round trip, three cosines per member: against the residual, against
      // the query, and against its own anchor's stored (grouped) vector.
      `SELECT m.doc_id, p.anchor_id,
              1 - (m.embedding <=> $1::vector) AS residual_sim,
              1 - (m.embedding <=> $2::vector) AS query_sim,
              1 - (m.embedding <=> a.embedding) AS group_sim
         FROM unnest($3::uuid[], $4::uuid[]) AS p(member_id, anchor_id)
         JOIN atlas_doc_embeddings m ON m.doc_id = p.member_id
         JOIN atlas_doc_embeddings a ON a.doc_id = p.anchor_id`,
      [
        toVectorLiteral(vecs.residual),
        toVectorLiteral(vecs.query),
        toUuidArrayLiteral(members),
        toUuidArrayLiteral(members.map((id) => anchorOf.get(id)!)),
      ],
    )) as LeafRow[];
    if (rows.length < 2) return undefined;
    const fused = fuseLeafScores(rows);
    return (id: string) => fused.get(id);
  } catch (err) {
    console.warn(`  leaf attribution fell back to lexical: ${(err as Error).message}`);
    return undefined;
  }
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
