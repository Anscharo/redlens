// The pgvector statements behind semantic search: the unit statement, the
// briefing statement over `atlas_doc_briefings`, the scope clause they share,
// leaf scoring, and the reader's fusion of the briefing list with the leaves.
import { sql, toVectorLiteral, toUuidArrayLiteral } from "../db.ts";
import { fromUuidArray } from "../pg-array.ts";
import { config } from "../config.ts";
import { rrfFuse } from "../../lib/searchSemantic.ts";
import { fuseLeafScores, leafRuleFor, type LeafRow, type LeafSemanticScore } from "./embed-units.ts";
import type { Hit, SemanticResult } from "./search.ts";

/**
 * Planner setting a SCOPED query runs under, inside its own transaction.
 *
 * An HNSW index scan is approximate in a way that breaks a filtered query: it
 * walks the graph for `hnsw.ef_search` (default 40) nearest candidates and
 * Postgres applies the WHERE clause to THOSE, so `in:A.6` with LIMIT 40
 * returned 3 rows — the 3 of the 40 globally nearest anchors that happened to
 * sit under A.6 (measured with EXPLAIN ANALYZE: index scan 38 rows,
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

/**
 * Run a vector statement taking `($1 = vector literal, $2 = limit)` plus `$3 =
 * scope` when scoped. A scoped one runs in its own transaction under
 * `SCOPED_SCAN_SETTING`; an unscoped one keeps the index.
 */
async function runVectorStatement<R>(stmt: string, lit: string, limit: number, scope?: string): Promise<R[]> {
  const rows = scope
    ? await sql.begin(async (tx) => {
        await tx.unsafe(SCOPED_SCAN_SETTING);
        return tx.unsafe(stmt, [lit, limit, scope]);
      })
    : await sql.unsafe(stmt, [lit, limit]);
  return rows as R[];
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
export async function runBriefings(lit: string, limit: number, scope: string | undefined): Promise<Hit[]> {
  try {
    const stmt = `SELECT b.doc_id AS id, 1 - (b.embedding <=> $1::vector) AS score
       FROM atlas_doc_briefings b JOIN atlas_doc_meta m ON m.id = b.doc_id
       WHERE b.embedding IS NOT NULL${semanticScopeSql(scope)}
       ORDER BY b.embedding <=> $1::vector LIMIT $2`;
    const rows = await runVectorStatement<{ id: string; score: number }>(stmt, lit, limit, scope);
    return rows.map((r, i) => ({ id: r.id, rank: i, score: Number(r.score), source: "briefing" }));
  } catch (err) {
    console.warn(`  briefing leg skipped: ${(err as Error).message}`);
    return [];
  }
}

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

/**
 * Score group members so `pickLeaf` can choose one, using only vectors the
 * request already has — see `fuseLeafScores` for the rule and its measurement.
 *
 * Best-effort by design: no vectors, no DB, or fewer than two scorable members
 * returns undefined and attribution falls back to the lexical pick. It embeds
 * nothing, so it cannot time out.
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
    const fused = fuseLeafScores(rows, leafRuleFor(config.embedModel));
    return (id: string) => fused.get(id);
  } catch (err) {
    console.warn(`  leaf attribution fell back to lexical: ${(err as Error).message}`);
    return undefined;
  }
}

// Rows are ordered by ascending distance (descending cosine).
/** Unit rows to hits, cut at the relevance floor and at `overFetch`. */
export function unitHits(rows: { id: string; score: number; member_ids?: unknown }[], overFetch: number): Hit[] {
  const out: Hit[] = [];
  for (const r of rows) {
    // Once one row falls below the relevance floor, every later row does too — stop.
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
  return out;
}
