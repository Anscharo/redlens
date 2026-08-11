// Preview diff rendering on top of the shared diff core (src/lib/diffCore.ts —
// the same LCS / word-diff / pairing the live history pipeline uses), producing
// the DiffLine[] shape <DiffView> renders.
//
// One entry point: contentDiff — identity diff of one doc's content across two
// atlases. A GitHub-patch parser lived here too, for the days when a preview's
// changed documents were derived from changed FILE PATHS; snapshot.ts now diffs
// uuid-keyed snapshots instead, so nothing supplies a unified patch any more.

import type { DiffLine } from "../../lib/history";
import { lcsOps, pairAdjacentLines, trimContext, capDiff } from "../../lib/diffCore";

// Identity diff: two versions of the SAME doc's content → DiffLine[]. NOTE:
// compares against CURRENT main, not the merge base — if main edited the same
// doc after the fork branched, those edits appear too ("vs live atlas").
export function contentDiff(prev: string, curr: string, maxLines = 20): DiffLine[] {
  if (prev === curr) return [];
  // "" means NO lines, not one empty line — split would yield [""] and emit a
  // spurious ["-",""] when diffing against empty (brand-new doc content).
  const a = prev === "" ? [] : prev.split("\n");
  const b = curr === "" ? [] : curr.split("\n");
  return capDiff(trimContext(pairAdjacentLines(lcsOps(a, b))), maxLines);
}
