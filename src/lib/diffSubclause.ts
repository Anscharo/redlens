// Subclause-level refinement, inserted between word and sentence in the
// promotion hierarchy: when a sentence pair earns promotion, this module
// tries aligning at comma/semicolon/parenthetical granularity FIRST — exact
// shared subclauses render as plain unchanged text, only the changed
// subclauses swap. Whole-sentence swap is the fallback ONLY when the two
// sentences share no subclause at all. Pure, no React.

import type { WordSegment } from "./history";
import { lcsOps, wordDiff, mergeOps } from "./diffCore";
import { changeStats, shouldPromote, segmentSubclauses } from "./diffSentences";
import { absorbIslands } from "./diffIslands";

type UnitOp = { op: "=" | "-" | "+"; text: string };

/** The one-level word-diff decision, shared by sentence-pair and
 *  subclause-pair refinement: word-diff the pair, decide promotion from
 *  PRE-absorption stats (ratio) + POST-absorption runs (shape) — same rule
 *  everywhere in this hierarchy. Not promoted -> absorbed word segments,
 *  fullSwap false. Promoted -> the caller decides what that means at its own
 *  level (sentence level tries subclause decomposition first; a subclause
 *  pair just swaps, no further recursion beneath it). */
function wordLevelDecision(oldUnit: string, newUnit: string): { segs: WordSegment[]; fullSwap: boolean } {
  const wd = wordDiff(oldUnit, newUnit);
  const genuine = changeStats(wd);
  const absorbed = absorbIslands(wd);
  const promoteStats = { ...genuine, runs: changeStats(absorbed).runs };
  if (!shouldPromote(promoteStats)) return { segs: absorbed, fullSwap: false };
  return { segs: [["-", oldUnit], ["+", newUnit]], fullSwap: true };
}

/** LCS over subclause arrays, trim-normalized comparison with original-slice
 *  recovery — same technique as sentenceOps in diffProse.ts. "=" ops emit
 *  the new side's original slice. */
function subclauseOps(oldSubs: string[], newSubs: string[]): UnitOp[] {
  const raw = lcsOps(
    oldSubs.map((s) => s.trim()),
    newSubs.map((s) => s.trim()),
  );
  const out: UnitOp[] = [];
  let i = 0;
  let j = 0;
  for (const [op] of raw) {
    if (op === "=") {
      out.push({ op: "=", text: newSubs[j] });
      i++;
      j++;
    } else if (op === "-") {
      out.push({ op: "-", text: oldSubs[i] });
      i++;
    } else {
      out.push({ op: "+", text: newSubs[j] });
      j++;
    }
  }
  return out;
}

/** Region-wise subclause assembly (mirrors buildSegments in diffProse.ts):
 *  "=" subclauses pass through as-is; each changed region pairs subclauses
 *  1:1 and applies wordLevelDecision. If EVERY pair in a region fullSwap
 *  (and there's more than one pair, or unpaired leftovers), collapse to one
 *  "-" block + one "+" block; otherwise emit each pair's segs in order
 *  (mixed results keep their internal "=" content), then leftovers as plain
 *  "-"/"+". */
function buildSubclauseSegments(ops: UnitOp[]): WordSegment[] {
  const result: WordSegment[] = [];
  let k = 0;
  while (k < ops.length) {
    if (ops[k].op === "=") {
      result.push(["=", ops[k].text]);
      k++;
      continue;
    }
    const removals: string[] = [];
    while (k < ops.length && ops[k].op === "-") removals.push(ops[k++].text);
    const additions: string[] = [];
    while (k < ops.length && ops[k].op === "+") additions.push(ops[k++].text);

    const pairs = Math.min(removals.length, additions.length);
    const decisions: { segs: WordSegment[]; fullSwap: boolean }[] = [];
    for (let p = 0; p < pairs; p++) decisions.push(wordLevelDecision(removals[p], additions[p]));

    const allFullSwap = pairs > 0 && decisions.every((d) => d.fullSwap);
    const hasLeftovers = removals.length !== additions.length;
    if (allFullSwap && (pairs > 1 || hasLeftovers)) {
      result.push(["-", removals.join("")]);
      result.push(["+", additions.join("")]);
    } else {
      for (const d of decisions) result.push(...d.segs);
      for (let p = pairs; p < removals.length; p++) result.push(["-", removals[p]]);
      for (let p = pairs; p < additions.length; p++) result.push(["+", additions[p]]);
    }
  }
  return result;
}

/** Sentence-pair refinement: word-diff first (today's behavior when it
 *  doesn't promote). When it DOES promote, try subclause-level alignment
 *  before collapsing to a whole-sentence swap — exact shared subclauses
 *  render as plain unchanged text, only the changed ones swap, each
 *  independently re-offered the same word-vs-swap decision one level down.
 *  `fullSwap: true` in the result means "genuinely no shared subclause" —
 *  callers use it to decide whether a multi-sentence region can coalesce. */
export function refineSentencePair(oldSent: string, newSent: string): { segs: WordSegment[]; fullSwap: boolean } {
  const wordLevel = wordLevelDecision(oldSent, newSent);
  if (!wordLevel.fullSwap) return wordLevel;

  const oldSubs = segmentSubclauses(oldSent);
  const newSubs = segmentSubclauses(newSent);
  const ops = subclauseOps(oldSubs, newSubs);
  if (!ops.some((o) => o.op === "=")) return { segs: [["-", oldSent], ["+", newSent]], fullSwap: true };

  return { segs: mergeOps(buildSubclauseSegments(ops)), fullSwap: false };
}
