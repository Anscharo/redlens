import { describe, it, expect } from "vitest";
import { nrChiclets, nrSidebarChiclets, realDepth, segmentDepths, depthColor, chicletColor } from "./depth";

describe("nrChiclets (reader)", () => {
  it("renders the bare token per-character with a neutral 'NR-' prefix", () => {
    const { parts, depths } = nrChiclets("NR-12", 6);
    expect(parts).toEqual(["N", "R", "-", "1", "2"]);
    // "NR-" prefix (incl. dash) is depth 0; the number takes the true depth.
    expect(depths).toEqual([0, 0, 0, 6, 6]);
  });

  it("handles multi-digit numbers", () => {
    const { depths } = nrChiclets("NR-103", 4);
    expect(depths).toEqual([0, 0, 0, 4, 4, 4]);
  });
});

describe("nrSidebarChiclets", () => {
  it("pins N/R left and stretches the (glyph-less) dash so the number sits past the parent", () => {
    // Parent A.1.6.4.3.2 (6 cols): N@0, R@1, dash spans cols 2-5 (4 slots), 1@6, 2@7.
    // The dash slot has no glyph (empty string) — only the gradient connector line.
    const { parts, slots } = nrSidebarChiclets("NR-12", "A.1.6.4.3.2", 6);
    expect(parts).toEqual(["N", "R", "", "1", "2"]);
    expect(slots).toEqual([1, 1, 4, 1, 1]);
    // grid column where the number begins == parent segment count.
    // Anchor on the empty-string dash slot, not the first "1" (a lead char could be "1").
    const dashIdx = parts.indexOf("");
    const numStartCol = slots.slice(0, dashIdx + 1).reduce((a, b) => a + b, 0);
    expect(numStartCol).toBe(6);
  });

  it("colours 'NR' like the parent's first segment ('A', depth 0) and the number at true depth", () => {
    const { parts, depths } = nrSidebarChiclets("NR-1", "A.1.5.4", 5);
    expect(parts).toEqual(["N", "R", "", "1"]);
    expect(depths).toEqual([0, 0, 5, 5]); // N,R like A(0); dash + number at true depth 5
  });

  it("gives the dash a gradient through every parent colour ending on the number colour", () => {
    const { gradients } = nrSidebarChiclets("NR-12", "A.1.6.4.3.2", 6);
    // only the dash carries a gradient
    expect(gradients.filter(Boolean)).toHaveLength(1);
    const dashGrad = gradients.find(Boolean);
    // parent A.1.6.4.3.2 colours (depths 0-5) then the number colour (depth 6).
    // Depth-0 is var(--tan-2) since the density+contrast pass (see chicletColor).
    expect(dashGrad).toBe(
      "linear-gradient(to right, var(--tan-2), var(--depth-1), var(--depth-2), var(--depth-3), var(--depth-4), var(--depth-5), var(--depth-6))",
    );
  });

  it("keeps a single-slot dash for shallow parents", () => {
    const { parts, slots } = nrSidebarChiclets("NR-3", "A.1", 5);
    expect(parts).toEqual(["N", "R", "", "3"]);
    expect(slots).toEqual([1, 1, 1, 1]);
  });

  it("falls back to a normal dash when the parent doc_no is missing", () => {
    const { slots } = nrSidebarChiclets("NR-7", undefined, 3);
    expect(slots).toEqual([1, 1, 1, 1]);
  });

  it("renders a dashless token per-character at the given depth (defensive fallback)", () => {
    const result = nrSidebarChiclets("NR7", "A.1", 4);
    expect(result.parts).toEqual(["N", "R", "7"]);
    expect(result.depths).toEqual([4, 4, 4]);
    expect(result.slots).toEqual([1, 1, 1]);
    expect(result.gradients).toEqual([undefined, undefined, undefined]);
  });
});

describe("realDepth", () => {
  it("returns segment count minus one for a plain doc_no", () => {
    expect(realDepth("A.1.6.4")).toBe(3);
    expect(realDepth("A")).toBe(0);
  });

  it("gives an NR with no parent depth 1", () => {
    expect(realDepth("NR-5")).toBe(1);
  });

  it("nests an NR one deeper than its parent", () => {
    expect(realDepth("NR-5", "A.1.6.4")).toBe(4);
  });

  it("treats a Scenario Variation (.varX) as one deeper than its base scenario", () => {
    expect(realDepth("A.1.6.4.var1")).toBe(realDepth("A.1.6.4") + 1);
    expect(realDepth("A.1.6.4.var1")).toBe(4);
  });

  it("collapses an Annotation's .0.3.X marker to one past its target's depth", () => {
    // Target "A.1.6" sits at depth 2; the Annotation marker (.0.3.1) adds no
    // extra depth of its own beyond the target + 1.
    expect(realDepth("A.1.6.0.3.1")).toBe(3);
  });

  it("adds one more level for a nested Action Tenet clause (.0.4.X.1.Y) after the marker", () => {
    expect(realDepth("A.1.6.0.4.2.1.3")).toBe(4);
  });

  it("adds one level per trailing segment when the tail isn't a 1.Y pair", () => {
    // After the .0.6.X (Active Data) marker, a single trailing non-pair segment
    // still counts as one extra level.
    expect(realDepth("A.1.6.0.6.2.5")).toBe(4);
  });
});

describe("segmentDepths", () => {
  it("returns [1] for an NR doc_no regardless of content", () => {
    expect(segmentDepths("NR-5")).toEqual([1]);
  });

  it("assigns depth 0 to the root segment and increments for each plain segment after", () => {
    expect(segmentDepths("A.1.6.4")).toEqual([0, 1, 2, 3]);
  });

  it("treats a .varX segment as one deeper, matching realDepth", () => {
    expect(segmentDepths("A.1.6.4.var1")).toEqual([0, 1, 2, 3, 4]);
  });

  it("holds the whole .0.3.X Annotation marker group at one shared depth", () => {
    expect(segmentDepths("A.1.6.0.3.1")).toEqual([0, 1, 2, 3, 3, 3]);
  });

  it("gives a nested Action Tenet clause (.0.4.X.1.Y) one more depth than the marker group", () => {
    expect(segmentDepths("A.1.6.0.4.2.1.3")).toEqual([0, 1, 2, 3, 3, 3, 4, 4]);
  });

  it("agrees with realDepth's value on the final segment", () => {
    for (const docNo of ["A.1.6.4", "A.1.6.0.3.1", "A.1.6.0.4.2.1.3"]) {
      const depths = segmentDepths(docNo);
      expect(depths[depths.length - 1]).toBe(realDepth(docNo));
    }
  });
});

describe("depthColor", () => {
  it("maps a depth to its CSS variable", () => {
    expect(depthColor(5)).toBe("var(--depth-5)");
  });

  it("clamps below 1 up to 1", () => {
    expect(depthColor(0)).toBe("var(--depth-1)");
    expect(depthColor(-3)).toBe("var(--depth-1)");
  });

  it("clamps above 17 down to 17", () => {
    expect(depthColor(20)).toBe("var(--depth-17)");
  });
});

describe("chicletColor", () => {
  it("gives depth 0 the neutral tan color, not a depth color", () => {
    expect(chicletColor(0)).toBe("var(--tan-2)");
  });

  it("delegates to the depth palette for depth >= 1, clamped the same as depthColor", () => {
    expect(chicletColor(5)).toBe("var(--depth-5)");
    expect(chicletColor(30)).toBe("var(--depth-17)");
  });
});
