// How a retrieved group's members are SCORED, once their three cosines are in
// hand. Pure, with no DB or network import, because this is the part the
// measurement is about and the eval must be able to import the shipped rule
// rather than a copy of it — leaf-attribution.ts supplies the cosines.
import { rrfFuse } from "../../lib/searchSemantic.ts";

// Number of retrieved anchor titles whose words are stripped to build the residual
// query. 20 is the measured peak (scripts/aux/leaf-attribution-experiment.ts):
// attribution accuracy rises 40% at top-1 -> 50% at top-10 -> 51% at top-20, then
// falls back to 46% by top-50 as genuine question words start being stripped too.
export const RESIDUAL_ANCHOR_K = 20;

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

/** One member's three similarities, as the scoring query returns them. */
export interface LeafRow {
  doc_id: string;
  anchor_id: string;
  /** Cosine to the residual query — the rule that works. */
  residual_sim: number;
  /** Cosine to the query as typed. */
  query_sim: number;
  /** Cosine to this member's own group anchor. */
  group_sim: number;
}

/**
 * How much a member is penalised for looking like the GROUP it sits in.
 *
 * Subtracting a per-group constant cannot reorder that group's members, which is
 * why scoring against the plain query fails outright; this term is per MEMBER —
 * it demotes the one that merely echoes the group's name in favour of the one
 * that answers the question. Measured flat across 0.25–0.75 (43.9 / 42.9 /
 * 41.8%), so it is not a knife-edge fit.
 */
export const GROUP_ECHO_PENALTY = 0.25;

/**
 * Fuse the two rankings into one score per member, WITHIN each group.
 *
 * Two rankings, because they fail on different members, fused with `rrfFuse` —
 * the same primitive the legs themselves are fused with:
 *   · cosine to the RESIDUAL query (39.8% alone)
 *   · cosine to the query minus GROUP_ECHO_PENALTY × similarity to its own
 *     anchor (35.7% alone)
 * Together 43.9%, against 48.0% for the two-round-trip rule they replace and
 * 29.6% for the lexical fallback. Ranks are per group because choosing a leaf is
 * a choice among THAT group's members; ranking globally would let a crowded
 * group's also-rans outrank a small group's best.
 *
 * Two rankings that disagree EXACTLY produce a tie (RRF is symmetric), and
 * `pickLeaf` then takes the first — which is member order, i.e. the anchor. Real
 * cosines are dense enough that exact ties do not occur; the case worth knowing
 * is that this rule never breaks a tie in favour of either ranking.
 *
 * Pure, because it is the part the measurement is about — the SQL around it only
 * supplies the three cosines.
 */
export function fuseLeafScores(rows: readonly LeafRow[]): Map<string, number> {
  const byGroup = new Map<string, LeafRow[]>();
  for (const r of rows) {
    const g = byGroup.get(r.anchor_id);
    if (g) g.push(r);
    else byGroup.set(r.anchor_id, [r]);
  }
  const fused = new Map<string, number>();
  for (const group of byGroup.values()) {
    const echo = (r: LeafRow) => Number(r.query_sim) - GROUP_ECHO_PENALTY * Number(r.group_sim);
    const byResidual = [...group].sort((a, b) => Number(b.residual_sim) - Number(a.residual_sim)).map((r) => r.doc_id);
    const byEcho = [...group].sort((a, b) => echo(b) - echo(a)).map((r) => r.doc_id);
    for (const [id, score] of rrfFuse([byResidual, byEcho])) fused.set(id, score);
  }
  return fused;
}
