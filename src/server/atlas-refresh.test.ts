// Run under `bun test` (NOT vitest) — these modules transitively import Bun's
// `SQL`; vitest.config.ts excludes src/server for that reason.
import { describe, it, expect } from "bun:test";
import { buildIndexes, type AtlasNode, type Edge } from "./indexes.ts";
import { diffDocs, patchDocs, isEmptyDelta, applyInPlaceUpdate } from "./atlas-refresh.ts";

function doc(id: string, over: Partial<AtlasNode> = {}): AtlasNode {
  return {
    id,
    doc_no: over.doc_no ?? id,
    title: over.title ?? id,
    type: over.type ?? "Core",
    depth: over.depth ?? 1,
    parentId: over.parentId ?? null,
    order: over.order ?? 0,
    content: over.content ?? "",
    ...over,
  };
}

function edge(id: number, from: string, to: string): Edge {
  return {
    id,
    from_id: from,
    from_type: "doc",
    to_id: to,
    to_type: "doc",
    edge_type: "cites",
    source_doc_nos: null,
    weight: 1,
    meta: null,
  };
}

describe("diffDocs", () => {
  it("classifies added / changed / removed by content hash", () => {
    const old = new Map<string, AtlasNode>([
      ["a", doc("a", { content: "alpha" })],
      ["b", doc("b", { content: "bravo" })],
      ["c", doc("c", { content: "charlie" })],
    ]);
    const next = [
      doc("a", { content: "alpha" }), // unchanged
      doc("b", { content: "bravo CHANGED" }), // modified
      doc("d", { content: "delta" }), // added
      // "c" dropped
    ];

    const delta = diffDocs(old, next);
    expect(delta.added.map((d) => d.id)).toEqual(["d"]);
    expect(delta.changed.map((d) => d.id)).toEqual(["b"]);
    expect(delta.removed).toEqual(["c"]);
  });

  it("ignores doc_no/parent/order churn when content is unchanged (renumber-stable)", () => {
    const old = new Map<string, AtlasNode>([["a", doc("a", { doc_no: "A.1", content: "alpha" })]]);
    const next = [doc("a", { doc_no: "A.2", parentId: "x", order: 9, content: "alpha" })];
    expect(isEmptyDelta(diffDocs(old, next))).toBe(true);
  });
});

describe("patchDocs", () => {
  it("applies a delta to the live MiniSearch index and docMap", () => {
    const ix = buildIndexes(
      [
        doc("a", { content: "alpha zebraword" }),
        doc("b", { content: "bravo oldtoken" }),
        doc("c", { content: "charlie uniqueremoved" }),
      ],
      [],
      [],
      {},
    );

    const next = [
      doc("a", { content: "alpha zebraword" }),
      doc("b", { content: "bravo newtoken" }), // changed
      doc("d", { content: "delta freshtoken" }), // added
      // c removed
    ];
    patchDocs(ix, diffDocs(ix.docMap, next));

    // docMap reflects add/remove
    expect([...ix.docMap.keys()].sort()).toEqual(["a", "b", "d"]);
    expect(ix.docMap.has("c")).toBe(false);

    // added doc is searchable
    expect(ix.mini.search("freshtoken").some((r) => r.id === "d")).toBe(true);
    // changed doc: new token hits, old token gone
    expect(ix.mini.search("newtoken").some((r) => r.id === "b")).toBe(true);
    expect(ix.mini.search("oldtoken").length).toBe(0);
    // removed doc no longer matches
    expect(ix.mini.search("uniqueremoved").length).toBe(0);
  });

  it("rebuilds byDocNo so renumbered/added docs resolve and removed ones don't", () => {
    const ix = buildIndexes([doc("a", { doc_no: "A.1", content: "alpha" })], [], [], {});
    patchDocs(ix, diffDocs(ix.docMap, [doc("a", { doc_no: "A.9", content: "alpha v2" })]));
    expect(ix.byDocNo.get("A.9")?.id).toBe("a");
    expect(ix.byDocNo.has("A.1")).toBe(false);
  });
});

describe("applyInPlaceUpdate", () => {
  it("patches the index, reassigns the graph, and advances meta in place", () => {
    const ix = buildIndexes(
      [doc("a", { content: "alpha zebraword" }), doc("b", { content: "bravo" })],
      [],
      [edge(1, "a", "b")],
      { atlasCommit: "old" },
    );
    expect(ix.graph.hasDirectedEdge("a", "b")).toBe(true);

    const delta = applyInPlaceUpdate(
      ix,
      [doc("a", { content: "alpha zebraword" }), doc("c", { content: "charlie" })], // a unchanged, c new, b gone
      [],
      [edge(2, "a", "c")],
      { atlasCommit: "new" },
    );

    // docs + delta
    expect([...ix.docMap.keys()].sort()).toEqual(["a", "c"]);
    expect(delta.removed).toEqual(["b"]);
    expect(delta.added.map((d) => d.id)).toEqual(["c"]);
    expect(delta.changed.length).toBe(0);
    // MiniSearch patched
    expect(ix.mini.search("charlie").some((r) => r.id === "c")).toBe(true);
    expect(ix.mini.search("bravo").length).toBe(0);
    // graph reassigned wholesale from the new edges
    expect(ix.graph.hasNode("c")).toBe(true);
    expect(ix.graph.hasNode("b")).toBe(false);
    expect(ix.graph.hasDirectedEdge("a", "c")).toBe(true);
    expect(ix.graph.hasDirectedEdge("a", "b")).toBe(false);
    // meta advanced (the convergence signal)
    expect(ix.meta.atlasCommit).toBe("new");
  });
});
