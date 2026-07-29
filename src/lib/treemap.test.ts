import { describe, expect, it } from "vitest";
import { buildTreemap, squarify } from "./treemap";
import type { ChunkNode } from "./crossview";

describe("squarify", () => {
  it("fills the box exactly and puts the first (largest) area at the origin", () => {
    const box = { x: 0, y: 0, w: 100, h: 100 };
    const rects = squarify([6000, 3000, 1000], box);
    expect(rects).toHaveLength(3);
    expect(rects[0].x).toBe(0);
    expect(rects[0].y).toBe(0);
    const area = rects.reduce((s, r) => s + r.w * r.h, 0);
    expect(area).toBeCloseTo(10000, 5);
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(-1e-9);
      expect(r.y).toBeGreaterThanOrEqual(-1e-9);
      expect(r.x + r.w).toBeLessThanOrEqual(100 + 1e-9);
      expect(r.y + r.h).toBeLessThanOrEqual(100 + 1e-9);
    }
  });
});

describe("buildTreemap", () => {
  const tree: ChunkNode[] = [
    {
      title: "Big",
      docs: 75,
      children: [
        { title: "Big.major", docs: 60 },
        { title: "Big.minor", docs: 14 },
      ],
    },
    { title: "Small", docs: 25 },
  ];

  it("sizes rects by docs share and recurses into the largest child", () => {
    const rects = buildTreemap(tree, { minArea: 0, maxDepth: 3, pad: 0, padTop: 0 });
    expect(rects[0].node.title).toBe("Big");
    expect((rects[0].w * rects[0].h) / 10000).toBeCloseTo(0.75, 5);
    expect(rects[0].x).toBe(0);
    expect(rects[0].y).toBe(0);
    const major = rects[0].children[0];
    expect(major.node.title).toBe("Big.major");
    // Largest sub-chunk anchors at its parent's top-left corner.
    expect(major.x).toBeCloseTo(rects[0].x, 5);
    expect(major.y).toBeCloseTo(rects[0].y, 5);
    expect(major.path.map((p) => p.title)).toEqual(["Big"]);
  });

  it("respects maxDepth", () => {
    const rects = buildTreemap(tree, { minArea: 0, maxDepth: 1, pad: 0, padTop: 0 });
    expect(rects[0].children).toHaveLength(0);
  });
});
