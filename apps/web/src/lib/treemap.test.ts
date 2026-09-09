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

  it("always keeps top-level groups; nested nodes need ≥ minShare of atlasTotal", () => {
    const mixed: ChunkNode[] = [
      {
        title: "Big",
        docs: 90,
        children: [
          { title: "Big.major", docs: 80 },
          { title: "Exactly 2%", docs: 2 }, // 2% of Atlas — keep
          { title: "Tiny nested", docs: 1 }, // 1% of Atlas — drop
        ],
      },
      { title: "Medium", docs: 8 },
      { title: "Tiny root", docs: 2 }, // 2% of Atlas but top-level — keep
    ];
    const rects = buildTreemap(mixed, {
      minArea: 0,
      maxDepth: 3,
      pad: 0,
      padTop: 0,
      minShare: 0.02,
      atlasTotal: 100,
    });
    expect(rects.map((r) => r.node.title)).toEqual(["Big", "Medium", "Tiny root"]);
    expect(rects[0].children.map((c) => c.node.title)).toEqual(["Big.major", "Exactly 2%"]);
  });

  it("keeps a nested node at minShare of the Atlas, not of its parent", () => {
    const mixed: ChunkNode[] = [
      {
        title: "Mid",
        docs: 40,
        children: [
          { title: "Mid.major", docs: 37 },
          { title: "Small of parent", docs: 3 }, // 3% of Atlas (keep), 7.5% of parent
        ],
      },
      {
        title: "Other",
        docs: 40,
        children: [
          { title: "Other.major", docs: 39 },
          { title: "Tiny of parent", docs: 1 }, // 1% of Atlas (drop) even though 2.5% of parent
        ],
      },
      { title: "Tiny root", docs: 20 },
    ];
    const rects = buildTreemap(mixed, {
      minArea: 0,
      maxDepth: 3,
      pad: 0,
      padTop: 0,
      minShare: 0.02,
      atlasTotal: 100,
    });
    expect(rects.map((r) => r.node.title)).toEqual(["Mid", "Other", "Tiny root"]);
    expect(rects[0].children.map((c) => c.node.title)).toEqual(["Mid.major", "Small of parent"]);
    expect(rects[1].children.map((c) => c.node.title)).toEqual(["Other.major"]);
  });

  it("recurses past depth 4 for nested nodes that still hold ≥ minShare of the Atlas", () => {
    // Mirrors Agent artifacts → List of Prime → Spark → Sky Primitives → Supply Side → Allocation → Active.
    const deep: ChunkNode[] = [
      {
        title: "Agent artifacts",
        docs: 70,
        children: [
          {
            title: "List of Prime Agent Artifacts",
            docs: 70,
            children: [
              {
                title: "Spark",
                docs: 21,
                children: [
                  {
                    title: "Sky Primitives",
                    docs: 18,
                    children: [
                      {
                        title: "Supply Side",
                        docs: 15,
                        children: [
                          {
                            title: "Allocation",
                            docs: 14,
                            children: [
                              { title: "Active Instances", docs: 8 },
                              { title: "Tiny leaf", docs: 1 },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      { title: "Accessibility", docs: 1 },
    ];
    const rects = buildTreemap(deep, {
      minArea: 0,
      maxDepth: 8,
      pad: 0,
      padTop: 0,
      minShare: 0.02,
      atlasTotal: 100,
    });
    expect(rects.map((r) => r.node.title)).toEqual(["Agent artifacts", "Accessibility"]);
    const titlesAt = (rs: ReturnType<typeof buildTreemap>, depth: number): string[] => {
      const out: string[] = [];
      const walk = (nodes: typeof rs, d: number) => {
        for (const n of nodes) {
          if (d === depth) out.push(n.node.title);
          walk(n.children, d + 1);
        }
      };
      walk(rs, 0);
      return out;
    };
    expect(titlesAt(rects, 3)).toEqual(["Sky Primitives"]);
    expect(titlesAt(rects, 4)).toEqual(["Supply Side"]);
    expect(titlesAt(rects, 6)).toEqual(["Active Instances"]);
  });

  it("raises the atlas-total floor to deepMinShare from deepShareFromDepth", () => {
    // depth 6 is the 7th nesting — more than six levels — so 3% drops and 4% stays.
    // depth 5 is still on the 2% floor, so a 3% sibling there is kept.
    const nest = (title: string, docs: number, children?: ChunkNode[]): ChunkNode => ({
      title,
      docs,
      ...(children ? { children } : {}),
    });
    const tree: ChunkNode[] = [
      nest("L0", 70, [
        nest("L1", 70, [
          nest("L2", 70, [
            nest("L3", 70, [
              nest("L4", 70, [
                nest("L5", 60, [
                  nest("Deep 4%", 4),
                  nest("Deep 3%", 3),
                ]),
                nest("Mid 3%", 3),
              ]),
            ]),
          ]),
        ]),
      ]),
    ];
    const rects = buildTreemap(tree, {
      minArea: 0,
      maxDepth: 8,
      pad: 0,
      padTop: 0,
      minShare: 0.02,
      deepMinShare: 0.04,
      deepShareFromDepth: 6,
      atlasTotal: 100,
    });
    const titlesAt = (rs: ReturnType<typeof buildTreemap>, depth: number): string[] => {
      const out: string[] = [];
      const walk = (nodes: typeof rs, d: number) => {
        for (const n of nodes) {
          if (d === depth) out.push(n.node.title);
          walk(n.children, d + 1);
        }
      };
      walk(rs, 0);
      return out;
    };
    expect(titlesAt(rects, 5).sort()).toEqual(["L5", "Mid 3%"]);
    expect(titlesAt(rects, 6)).toEqual(["Deep 4%"]);
  });
});
