// Unit-level diff plumbing shared by the sentence level (./diffProse) and the
// subclause level (./diffSubclause) of the promotion hierarchy. Both levels
// diff arrays of text units the same way and assemble changed regions the same
// way; they differ only in how a removed/added unit pair is refined. Pure, no
// React.

import type { WordSegment } from "@/lib/history";
import { lcsOps } from "@/lib/diffCore";

export type UnitOp = { op: "=" | "-" | "+"; text: string };
export type RefinedPair = { segs: WordSegment[]; fullSwap: boolean };

/** LCS over unit arrays, comparing on `key`-normalized text but recovering the
 *  ORIGINAL unit slices (so joining "="+"-" segments still reconstructs the old
 *  side, and "="+"+" the new side). "=" ops emit the NEW side's original slice. */
export function unitOps(oldUnits: string[], newUnits: string[], key: (unit: string) => string): UnitOp[] {
  const raw = lcsOps(oldUnits.map(key), newUnits.map(key));
  const out: UnitOp[] = [];
  let i = 0;
  let j = 0;
  for (const [op] of raw) {
    if (op === "=") {
      out.push({ op: "=", text: newUnits[j] });
      i++;
      j++;
    } else if (op === "-") {
      out.push({ op: "-", text: oldUnits[i] });
      i++;
    } else {
      out.push({ op: "+", text: newUnits[j] });
      j++;
    }
  }
  return out;
}

/** Walk unit ops region-by-region: each maximal run of "-" ops followed by "+"
 *  ops between "=" ops is one region. Units pair 1:1 by position within a
 *  region, each refined via `refinePair`. Collapsing an entire region to one
 *  "-" block + one "+" block requires EVERY pair to have come back a genuine
 *  fullSwap, plus more than one pair or unpaired leftovers — otherwise each
 *  pair's own segs are emitted in order (a mixed result keeps its internal "="
 *  content), followed by unpaired leftover units as plain "-"/"+" segments. */
export function assembleRegions(
  ops: UnitOp[],
  refinePair: (oldUnit: string, newUnit: string) => RefinedPair,
): WordSegment[] {
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
    const decisions: RefinedPair[] = [];
    for (let p = 0; p < pairs; p++) decisions.push(refinePair(removals[p], additions[p]));

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
