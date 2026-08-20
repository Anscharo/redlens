// Display-only contiguity repair for word-level diff segments: folds short
// accidental LCS matches ("=" islands, e.g. "the", "of", "and") sandwiched
// between two changed regions into their neighbors, so what would otherwise
// render as alternating "-"/"="/"+" confetti becomes one contiguous "-"
// block then one "+" block. Pure, no React. Purely cosmetic: the promotion
// decision in diffProse.ts is made from the PRE-absorption stats, so
// absorbed island characters never inflate the change ratio — this module
// only reshapes what gets DISPLAYED, never what gets counted.

import type { WordSegment } from "@/lib/history";
import { mergeOps } from "@/lib/diffCore";
import { MAX_ISLAND } from "./diffSentences";

function isAbsorbableIsland(seg: WordSegment): boolean {
  return seg[0] === "=" && seg[1].replace(/\s/g, "").length <= MAX_ISLAND;
}

/** Fold every "=" island (at most MAX_ISLAND non-ws chars — this also
 *  covers whitespace-only "=" segments, length 0) that sits between a "-"
 *  and a "+" (a genuine replacement region, in either order) into one merged
 *  "-" block (the span's old-side reconstruction) followed by one merged "+"
 *  block (its new-side reconstruction). The two neighbors must be
 *  OPPOSITE-sided: an island between two same-sided edits (e.g. a pure
 *  deletion "- Alpha = the - Bravo") is genuinely unchanged context, and
 *  folding it would emit the island on the empty side — inventing an
 *  addition (or deletion) that never happened, which also defeats the
 *  single-sided promotion guard downstream. Iterates to a fixpoint:
 *  re-merging after each fold can leave two same-op segments newly adjacent,
 *  fusing them and putting another island within reach. Reconstruction is
 *  exactly preserved throughout — an "=" segment's text already appears in
 *  both the old-side ("="+"-") and new-side ("="+"+") reconstruction; folding
 *  it into a "-" and a "+" only moves WHERE it contributes from, not whether. */
export function absorbIslands(segs: WordSegment[]): WordSegment[] {
  let current = mergeOps(segs);
  for (;;) {
    const idx = current.findIndex(
      (seg, i) =>
        i > 0 &&
        i < current.length - 1 &&
        isAbsorbableIsland(seg) &&
        current[i - 1][0] !== "=" &&
        current[i + 1][0] !== "=" &&
        // Only fold inside a true replacement (one "-" side, one "+" side).
        // Same-sided neighbors mean the island is real unchanged context.
        current[i - 1][0] !== current[i + 1][0],
    );
    if (idx === -1) return current;

    const before = current[idx - 1];
    const island = current[idx];
    const after = current[idx + 1];
    const oldText = (before[0] === "-" ? before[1] : "") + island[1] + (after[0] === "-" ? after[1] : "");
    const newText = (before[0] === "+" ? before[1] : "") + island[1] + (after[0] === "+" ? after[1] : "");

    const replaced: WordSegment[] = [
      ...current.slice(0, idx - 1),
      ["-", oldText],
      ["+", newText],
      ...current.slice(idx + 2),
    ];
    current = mergeOps(replaced);
  }
}
