import { describe, expect, it } from "vitest";
import { flattenChunkTree, crossviewChunksToCSV, type ChunkNode } from "./crossview";

const TREE: ChunkNode[] = [
  {
    title: "Agent artifacts",
    doc_no: "A.6",
    docs: 7459,
    children: [
      { id: "x", doc_no: "A.6.1.1", title: "List Of Prime Agent Artifacts", docs: 7447 },
      { id: "y", doc_no: "A.6.1.2", title: "List Of Executor Agent Artifacts", docs: 10 },
    ],
  },
  { title: "Accessibility", doc_no: "A.5", docs: 24 },
];

describe("flattenChunkTree", () => {
  it("walks depth-first with paths, depths, and atlas percentages", () => {
    const rows = flattenChunkTree(TREE, 10780);
    expect(rows.map((r) => r.path)).toEqual([
      "Agent artifacts",
      "Agent artifacts › List Of Prime Agent Artifacts",
      "Agent artifacts › List Of Executor Agent Artifacts",
      "Accessibility",
    ]);
    expect(rows[0].depth).toBe(0);
    expect(rows[1].depth).toBe(1);
    expect(rows[0].pctOfAtlas).toBe(69.2);
    expect(rows[3].pctOfAtlas).toBe(0.2);
  });

  it("tolerates chunks without doc_no (multi-root taxonomy groups)", () => {
    const rows = flattenChunkTree([{ title: "Actor rulebooks", docs: 165 }], 10780);
    expect(rows[0].doc_no).toBe("");
  });
});

describe("crossviewChunksToCSV", () => {
  it("emits a header and one quoted row per chunk", () => {
    const csv = crossviewChunksToCSV(TREE, 10780);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe('"path","doc_no","title","depth","docs","pct_of_atlas"');
    expect(lines).toHaveLength(1 + 4);
    expect(lines[1]).toContain('"Agent artifacts"');
    expect(lines[1]).toContain('"69.2"');
  });
});
