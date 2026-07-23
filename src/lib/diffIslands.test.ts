import { describe, it, expect } from "vitest";
import { absorbIslands } from "./diffIslands";
import { wordDiff } from "./diffCore";
import type { WordSegment } from "./history";

function reconstruct(segs: WordSegment[]): { old: string; new: string } {
  return {
    old: segs
      .filter(([op]) => op === "=" || op === "-")
      .map(([, t]) => t)
      .join(""),
    new: segs
      .filter(([op]) => op === "=" || op === "+")
      .map(([, t]) => t)
      .join(""),
  };
}

describe("absorbIslands", () => {
  it("folds a short common word sandwiched between two changed regions into one '-' block then one '+' block", () => {
    const oldLine = "AlphaVal the BravoVal";
    const newLine = "ZuluVal the YankeeVal";
    const wd = wordDiff(oldLine, newLine);
    const absorbed = absorbIslands(wd);

    expect(absorbed).toEqual([
      ["-", "AlphaVal the BravoVal"],
      ["+", "ZuluVal the YankeeVal"],
    ]);
    expect(reconstruct(absorbed)).toEqual({ old: oldLine, new: newLine });
  });

  it("does not absorb a big (> MAX_ISLAND) shared word", () => {
    const oldLine = "AlphaVal reporting BravoVal";
    const newLine = "ZuluVal reporting YankeeVal";
    const wd = wordDiff(oldLine, newLine);
    const absorbed = absorbIslands(wd);

    // "reporting" (9 non-ws chars) stays a standalone "=" — too big to absorb.
    expect(absorbed.some(([op, t]) => op === "=" && t.includes("reporting"))).toBe(true);
    expect(reconstruct(absorbed)).toEqual({ old: oldLine, new: newLine });
  });

  it("does not absorb a leading or trailing '=' (no changed region on one side)", () => {
    const oldLine = "The vault stores Bravo";
    const newLine = "The vault stores Yankee";
    const wd = wordDiff(oldLine, newLine);
    const absorbed = absorbIslands(wd);

    // "The vault stores " is a leading "=" with nothing changed before it —
    // never a sandwiched island, so it stays intact.
    expect(absorbed[0]).toEqual(["=", "The vault stores "]);
    expect(reconstruct(absorbed)).toEqual({ old: oldLine, new: newLine });
  });

  it("treats a whitespace-only '=' between changed regions as absorbable too", () => {
    const segs: WordSegment[] = [["-", "old1"], ["+", "new1"], ["=", " "], ["-", "old2"], ["+", "new2"]];
    const absorbed = absorbIslands(segs);

    expect(absorbed).toEqual([
      ["-", "old1 old2"],
      ["+", "new1 new2"],
    ]);
  });

  it("reaches a fixpoint: running it again on its own output is a no-op", () => {
    const oldLine = "AlphaVal the BravoVal for CharlieVal";
    const newLine = "ZuluVal the YankeeVal for OmegaVal";
    const wd = wordDiff(oldLine, newLine);
    const once = absorbIslands(wd);
    const twice = absorbIslands(once);

    expect(twice).toEqual(once);
  });

  it("chains multiple absorbable islands into a single contiguous block", () => {
    // "the" and "for" are each small enough to absorb; absorbing one can put
    // the other's neighbors newly adjacent, but the fixpoint loop handles it.
    const oldLine = "AlphaVal the BravoVal for CharlieVal";
    const newLine = "ZuluVal the YankeeVal for OmegaVal";
    const wd = wordDiff(oldLine, newLine);
    const absorbed = absorbIslands(wd);

    expect(absorbed).toEqual([
      ["-", oldLine],
      ["+", newLine],
    ]);
    expect(reconstruct(absorbed)).toEqual({ old: oldLine, new: newLine });
  });

  it("passes through an all-equal segment set unchanged", () => {
    const segs: WordSegment[] = [["=", "nothing changed here"]];
    expect(absorbIslands(segs)).toEqual(segs);
  });

  it("does NOT absorb an island between two same-sided deletions (pure delete stays inline)", () => {
    // "Alpha the Bravo stays." -> "the stays." is a PURE deletion: "the" is
    // retained context, not an addition. Folding it would emit a phantom "+ the".
    const oldLine = "Alpha the Bravo stays.";
    const newLine = "the stays.";
    const wd = wordDiff(oldLine, newLine);
    expect(wd.some(([op]) => op === "+")).toBe(false); // pre-absorption: no additions
    const absorbed = absorbIslands(wd);
    // The absorb step must not invent an addition where the source had none.
    expect(absorbed.some(([op]) => op === "+")).toBe(false);
    expect(reconstruct(absorbed)).toEqual({ old: oldLine, new: newLine });
  });

  it("does NOT absorb an island between two same-sided insertions (pure insert stays inline)", () => {
    // Mirror case: an inserted region around a retained "the" must not invent a
    // phantom "- the" on the old side.
    const segs: WordSegment[] = [["+", "Alpha "], ["=", "the"], ["+", " Bravo"]];
    const absorbed = absorbIslands(segs);
    expect(absorbed.some(([op]) => op === "-")).toBe(false);
    expect(reconstruct(absorbed)).toEqual({ old: "the", new: "Alpha the Bravo" });
  });

  it("still absorbs an island between opposite-sided edits (delete then insert)", () => {
    // The genuine replacement case is unaffected by the same-sided guard.
    const segs: WordSegment[] = [["-", "old"], ["=", " the "], ["+", "new"]];
    expect(absorbIslands(segs)).toEqual([
      ["-", "old the "],
      ["+", " the new"],
    ]);
  });
});
