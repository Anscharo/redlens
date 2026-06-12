// Preview diff rendering on top of the shared diff core (src/lib/diffCore.ts —
// the same LCS / word-diff / pairing the live history pipeline uses), producing
// the DiffLine[] shape <DiffView> renders.
//
// Two entry points:
//   patchToDiffLines — GitHub's unified `patch` field → DiffLine[]. We already
//     have the hunks, so the patch's own ±/context lines feed the pairing pass
//     directly (no line-level LCS).
//   contentDiff — identity diff of one doc's content across two atlases (used
//     for "changed" preview docs, where per-path patches would cross doc
//     identities when slots change occupants).

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

// A unified-diff patch → DiffLine[]. Hunks (`@@ ... @@`) become ["…"] gaps;
// each hunk body's ±/context lines flow through the pairing pass. Capped at
// `maxLines` (matching the live history path's 20-line cap) with a trailing ["…"].
export function patchToDiffLines(patch: string | undefined | null, maxLines = 20): DiffLine[] {
  if (!patch) return [];
  const out: DiffLine[] = [];
  let started = false;
  let cur: [string, string][] = [];
  const flush = () => {
    if (!cur.length) return;
    if (started) out.push(["…"]);
    out.push(...pairAdjacentLines(cur));
    started = true;
    cur = [];
  };
  for (const line of patch.split("\n")) {
    if (line === "") continue; // trailing split artifact; real blank context is " "
    if (line.startsWith("@@")) {
      flush();
      continue;
    }
    if (line.startsWith("\\")) continue; // "\ No newline at end of file"
    const tag = line[0];
    const text = line.slice(1);
    if (tag === "+") cur.push(["+", text]);
    else if (tag === "-") cur.push(["-", text]);
    else cur.push(["=", text]); // leading space = context
  }
  flush();
  return capDiff(out, maxLines);
}
