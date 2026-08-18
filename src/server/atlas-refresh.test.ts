// Run under `bun test` (NOT vitest) — these modules transitively import Bun's
// `SQL`; vitest.config.ts excludes src/server for that reason.
import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildIndexes, type AtlasNode, type Edge, type Indexes } from "./retrieval/indexes.ts";
import { diffDocs, patchDocs, isEmptyDelta, applyInPlaceUpdate, writeSearchIndex, refreshInPlaceFromDisk } from "./atlas-refresh.ts";
import { atlasQuery } from "./retrieval/query.ts";
import { config } from "./config.ts";

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
    addressRefs: over.addressRefs ?? [],
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

  it("rebuilds childrenIndex for a SECOND sibling under an existing parent (array-push path, not just first-child)", () => {
    const ix = buildIndexes([doc("p", { content: "parent" }), doc("a", { parentId: "p", order: 0, content: "alpha" })], [], [], {});
    expect(ix.childrenIndex.get("p")?.map((d) => d.id)).toEqual(["a"]);

    // "b" is a second child of "p": childrenIndex.get("p") already holds an
    // array (from "a") when rebuildDerivedMaps processes "b", so this exercises
    // the arr.push(d) branch — every earlier test here only ever added a
    // parent's FIRST child, which takes the `else childrenIndex.set(...)` path.
    patchDocs(
      ix,
      diffDocs(ix.docMap, [
        doc("p", { content: "parent" }),
        doc("a", { parentId: "p", order: 0, content: "alpha" }),
        doc("b", { parentId: "p", order: 1, content: "bravo" }),
      ]),
    );

    expect(ix.childrenIndex.get("p")?.map((d) => d.id)).toEqual(["a", "b"]);
  });

  it("atlas_query is lean by default and inlines deduped ancestors when enriched", async () => {
    const ix = buildIndexes(
      [
        doc("root", { doc_no: "A", title: "Root", content: "zebraword" }),
        doc("child", { doc_no: "A.1", parentId: "root", content: "zebraword alpha" }),
      ],
      [],
      [],
      {},
    );

    const lean = (await atlasQuery(ix, { q: "zebraword", k: 10, enrich: false })) as Record<string, any>;
    expect(lean.mode).toBe("search");
    expect(lean.results.length).toBeGreaterThan(0);
    expect(lean.results[0].content).toBeUndefined(); // lean: no full content
    expect(lean.results[0].snippet).toBeDefined(); // but a snippet
    expect(lean.ancestors).toBeUndefined(); // no ancestor map when not enriched

    const rich = (await atlasQuery(ix, { q: "zebraword", k: 10, enrich: true })) as Record<string, any>;
    expect(rich.results[0].content).toBeDefined();
    expect(rich.results[0].snippet).toBeUndefined(); // no redundant snippet alongside content
    const childRow = rich.results.find((r: any) => r.id === "child");
    expect(childRow.ancestor_ids).toEqual(["root"]); // ids only per-row
    expect(rich.ancestors.root).toMatchObject({ doc_no: "A", title: "Root" }); // deduped into top-level map
  });

  it("stamps response provenance (generatedAt + appCommit) while preserving atlasCommit", () => {
    const ix = buildIndexes([doc("a")], [], [], { atlasCommit: "abc123" });
    expect(ix.meta.atlasCommit).toBe("abc123");
    // generatedAt is filled with a parseable ISO timestamp at build time.
    expect(typeof ix.meta.generatedAt).toBe("string");
    expect(Number.isNaN(Date.parse(ix.meta.generatedAt as string))).toBe(false);
    // appCommit key is always present (null when no git env is set).
    expect("appCommit" in ix.meta).toBe(true);
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

describe("writeSearchIndex", () => {
  const fakeIx = { mini: { toJSON: () => ({ marker: 1 }) } } as unknown as Indexes;

  it("writes identical serialized JSON to both publicDir and distDir", () => {
    const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-refresh-public-"));
    const distDir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-refresh-dist-"));

    writeSearchIndex(fakeIx, publicDir, distDir);

    const publicJson = fs.readFileSync(path.join(publicDir, "search-index.json"), "utf8");
    const distJson = fs.readFileSync(path.join(distDir, "search-index.json"), "utf8");
    expect(publicJson).toBe(JSON.stringify({ marker: 1 }));
    expect(distJson).toBe(publicJson);
  });

  it("still writes publicDir and does not throw when distDir does not exist (best-effort dist mirror)", () => {
    const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-refresh-public-"));
    const missingDistDir = path.join(publicDir, "no-such-dir", "nested");

    expect(() => writeSearchIndex(fakeIx, publicDir, missingDistDir)).not.toThrow();

    const publicJson = fs.readFileSync(path.join(publicDir, "search-index.json"), "utf8");
    expect(publicJson).toBe(JSON.stringify({ marker: 1 }));
    expect(fs.existsSync(missingDistDir)).toBe(false);
  });
});

// The disk-orchestration wrapper used by the in-process updater's happy path
// (atlas-updater.ts's applyInPlace). Unlike applyInPlaceUpdate above (pure, in
// memory) this actually reads config.publicDir off disk and re-serializes
// search-index.json — the two things every layer above it (runRefreshFromDb's
// dropStaleSearchIndex, the fallback rebuild) assumes happened.
describe("refreshInPlaceFromDisk", () => {
  it("reads fresh artifacts off config.publicDir, patches the GIVEN indexes in place, and re-emits search-index.json", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-refresh-inplace-"));
    const prevPublicDir = config.publicDir;
    const prevDistDir = config.distDir;
    config.publicDir = dir;
    config.distDir = path.join(dir, "no-dist-here"); // absent on purpose — best-effort mirror only
    try {
      fs.writeFileSync(
        path.join(dir, "docs.json"),
        JSON.stringify({
          atlasCommit: "disk-sha",
          nodes: { a: { id: "a", doc_no: "A", title: "A", type: "Core", depth: 1, parentId: null, content: "alpha zebraword", order: 0, addressRefs: [] } },
        }),
      );
      fs.writeFileSync(path.join(dir, "graph.json"), JSON.stringify({ meta: { atlasCommit: "disk-sha" }, entities: [], edges: [] }));

      // "b" only exists on the PRE-refresh in-memory ix, not in the fresh disk
      // artifacts — it must come out as removed, same as applyInPlaceUpdate's
      // own contract, but reached through the disk-reading wrapper this time.
      const ix = buildIndexes([doc("a", { content: "alpha zebraword" }), doc("b", { content: "bravo, gone on disk" })], [], [], { atlasCommit: "old-sha" });
      const delta = refreshInPlaceFromDisk(ix);

      expect(delta.removed).toEqual(["b"]);
      expect(ix.meta.atlasCommit).toBe("disk-sha"); // patched IN PLACE, not swapped
      expect(ix.docMap.has("b")).toBe(false);

      const written = fs.readFileSync(path.join(dir, "search-index.json"), "utf8");
      expect(JSON.parse(written)).toEqual(ix.mini.toJSON()); // re-serialized from the PATCHED mini, not stale
    } finally {
      config.publicDir = prevPublicDir;
      config.distDir = prevDistDir;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
