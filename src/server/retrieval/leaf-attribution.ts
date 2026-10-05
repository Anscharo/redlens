// Leaf attribution: once the semantic leg has returned a GROUP, which member of
// it does the query actually want?
//
// Its own module because it is a self-contained stage — the group is already
// retrieved and nothing here runs a search. The arms behind the rule, and the
// numbers quoted below, live in scripts/eval/eval-leaf-attribution.ts.
import { type Indexes } from "./indexes.ts";
import { sql, toVectorLiteral, toUuidArrayLiteral } from "../db.ts";
import { rewriteSemanticHit, type LeafSemanticScore } from "./embed-units.ts";
import { config } from "../config.ts";
import { RESIDUAL_ANCHOR_K, fuseLeafScores, leafRuleFor, residualQuery, type LeafRow } from "./leaf-scores.ts";
import type { Hit, SemanticResult } from "./search.ts";

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
 * load-bearing: over 98 measured queries whose target is folded into a group,
 * scoring members against the plain query vector instead of a residual collapses
 * ICD disambiguation from 62.5% to 2.5%, worse than no semantic attribution at
 * all.
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
