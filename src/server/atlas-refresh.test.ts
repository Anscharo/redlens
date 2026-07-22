// Run under `bun test` (NOT vitest) — these modules transitively import Bun's
// `SQL`; vitest.config.ts excludes src/server for that reason.
import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildIndexes, type AtlasNode, type Edge } from "./indexes.ts";
import { diffDocs, patchDocs, isEmptyDelta, applyInPlaceUpdate, refreshInPlaceFromDisk } from "./atlas-refresh.ts";
import { atlasQuery } from "./query.ts";

// Captured at module-evaluation time (bun's test-collection sweep imports every
// test file before any test body runs), so these stay pristine even if another
// file's test body mocks the same modules and (for whatever reason) leaves the
// mock dangling past its own test — a `mock.module` call inside a test body
// can only run once test bodies start executing, strictly after every file's
// top-level code has already run.
const REAL_CONFIG = (await import("./config.ts")).config;
const REAL_INDEXES = { ...(await import("./indexes.ts")) };

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

async function restoreRealModules() {
  await mock.restore();
  // Belt-and-suspenders on top of mock.restore(): explicitly re-pin every module
  // this suite mocks back to its real (module-load-time-captured) implementation,
  // so a leaked mock can never survive past this file's own tests regardless of
  // what mock.restore() actually reverts.
  await mock.module("./config.ts", () => ({ config: REAL_CONFIG }));
  await mock.module("./indexes.ts", () => ({ ...REAL_INDEXES }));
}

describe("refreshInPlaceFromDisk", () => {
  beforeEach(restoreRealModules);
  afterEach(restoreRealModules);

  it("reads fresh artifacts from disk, patches the live index, and re-serializes search-index.json to public + dist", async () => {
    const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), "ar-pub-"));
    const distDir = fs.mkdtempSync(path.join(os.tmpdir(), "ar-dist-"));
    await mock.module("./config.ts", () => ({ config: { ...REAL_CONFIG, publicDir, distDir } }));
    await mock.module("./indexes.ts", () => ({
      ...REAL_INDEXES,
      readArtifactsFromDisk: () => ({
        docs: [doc("a", { content: "alpha zebraword" }), doc("fresh", { content: "freshtoken" })],
        entities: [],
        edges: [],
        meta: { atlasCommit: "disksha123" },
      }),
    }));

    const ix = buildIndexes([doc("a", { content: "alpha zebraword" }), doc("gone", { content: "bye" })], [], [], { atlasCommit: "old" });
    const delta = refreshInPlaceFromDisk(ix);

    expect(delta.added.map((d) => d.id)).toEqual(["fresh"]);
    expect(delta.removed).toEqual(["gone"]);
    expect(ix.meta.atlasCommit).toBe("disksha123");
    expect(ix.mini.search("freshtoken").some((r) => r.id === "fresh")).toBe(true);

    const written = JSON.parse(fs.readFileSync(path.join(publicDir, "search-index.json"), "utf8"));
    expect(written).toBeTruthy();
    expect(fs.existsSync(path.join(distDir, "search-index.json"))).toBe(true);

    fs.rmSync(publicDir, { recursive: true, force: true });
    fs.rmSync(distDir, { recursive: true, force: true });
  });

  it("swallows a dist/ write failure (dev has no dist/) and still returns the delta", async () => {
    const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), "ar-pub-"));
    const missingDistDir = path.join(publicDir, "no-such-dist-dir");
    await mock.module("./config.ts", () => ({ config: { ...REAL_CONFIG, publicDir, distDir: missingDistDir } }));
    await mock.module("./indexes.ts", () => ({
      ...REAL_INDEXES,
      readArtifactsFromDisk: () => ({
        docs: [doc("solo", { content: "solotoken" })],
        entities: [],
        edges: [],
        meta: { atlasCommit: "sha2" },
      }),
    }));

    const ix = buildIndexes([], [], [], { atlasCommit: "old" });
    const delta = refreshInPlaceFromDisk(ix);
    expect(delta.added.map((d) => d.id)).toEqual(["solo"]);
    expect(fs.existsSync(path.join(missingDistDir, "search-index.json"))).toBe(false);

    fs.rmSync(publicDir, { recursive: true, force: true });
  });
});
