import { describe, it, expect } from "vitest";
import { nrChiclets, nrSidebarChiclets } from "./depth";

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
    // grid column where the number begins == parent segment count
    const numStartCol = slots.slice(0, parts.indexOf("1")).reduce((a, b) => a + b, 0);
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
    // parent A.1.6.4.3.2 colours (depths 0-5) then the number colour (depth 6)
    expect(dashGrad).toBe(
      "linear-gradient(to right, var(--gray), var(--depth-1), var(--depth-2), var(--depth-3), var(--depth-4), var(--depth-5), var(--depth-6))",
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
});
