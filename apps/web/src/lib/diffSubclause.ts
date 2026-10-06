// Subclause-level refinement, inserted between word and sentence in the
// promotion hierarchy: when a sentence pair earns promotion, this module
// tries aligning at comma/semicolon/parenthetical granularity FIRST — exact
// shared subclauses render as plain unchanged text, only the changed
// subclauses swap. Whole-sentence swap is the fallback ONLY when the two
// sentences share no subclause at all. Pure, no React.

import { wordDiff, mergeOps } from "@/lib/diffCore";
import { changeStats, shouldPromote, segmentSubclauses } from "./diffSentences";
import { absorbIslands } from "./diffIslands";
import { assembleRegions, unitOps, type RefinedPair } from "./diffRegions";

/** The one-level word-diff decision, shared by sentence-pair and
 *  subclause-pair refinement: word-diff the pair, decide promotion from
 *  PRE-absorption stats (ratio) + POST-absorption runs (shape) — same rule
 *  everywhere in this hierarchy. Not promoted -> absorbed word segments,
 *  fullSwap false. Promoted -> the caller decides what that means at its own
 *  level (sentence level tries subclause decomposition first; a subclause
 *  pair just swaps, no further recursion beneath it). */
function wordLevelDecision(oldUnit: string, newUnit: string): RefinedPair {
  const wd = wordDiff(oldUnit, newUnit);
  const genuine = changeStats(wd);
  const absorbed = absorbIslands(wd);
  const promoteStats = { ...genuine, runs: changeStats(absorbed).runs };
  if (!shouldPromote(promoteStats)) return { segs: absorbed, fullSwap: false };
  return { segs: [["-", oldUnit], ["+", newUnit]], fullSwap: true };
}

/** Sentence-pair refinement: word-diff first (today's behavior when it
 *  doesn't promote). When it DOES promote, try subclause-level alignment
 *  before collapsing to a whole-sentence swap — exact shared subclauses
 *  render as plain unchanged text, only the changed ones swap, each
 *  independently re-offered the same word-vs-swap decision one level down.
 *  `fullSwap: true` in the result means "genuinely no shared subclause" —
 *  callers use it to decide whether a multi-sentence region can coalesce. */
export function refineSentencePair(oldSent: string, newSent: string): RefinedPair {
  const wordLevel = wordLevelDecision(oldSent, newSent);
  if (!wordLevel.fullSwap) return wordLevel;

  const oldSubs = segmentSubclauses(oldSent);
  const newSubs = segmentSubclauses(newSent);
  const ops = unitOps(oldSubs, newSubs, (s) => s.trim());
  if (!ops.some((o) => o.op === "=")) return { segs: [["-", oldSent], ["+", newSent]], fullSwap: true };

  return { segs: mergeOps(assembleRegions(ops, wordLevelDecision)), fullSwap: false };
}
