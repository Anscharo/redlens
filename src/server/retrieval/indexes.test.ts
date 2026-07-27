// Pure builder / IO tests for indexes.ts. Run under `bun test`.
//
// Covers buildIndexes (both with and without a prebuilt search-index.json),
// readArtifactsFromDisk against the real on-disk artifacts (already built —
// CLAUDE.md: never rebuild them here), the module-level state getters/setters
// (loadIndexes/setIndexes/getIndexes), docRowToNode, writeDocsJson/writeDocsSplit,
// and the small graph-traversal helpers (resolveNode/ancestorChain/descendantIds).
import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildIndexes,
  buildGraph,
  readArtifactsFromDisk,
  loadIndexes,
  setIndexes,
  getIndexes,
  rebuildFromDisk,
  docRowToNode,
  writeDocsJson,
  writeDocsSplit,
  resolveNode,
  ancestorChain,
  descendantIds,
  type AtlasNode,
  type DocMetaRow,
  type Entity,
  type Edge,
} from "./indexes.ts";
import { config } from "../config.ts";

// This file installs fixture indexes via setIndexes(); restore the real on-disk
// index set afterward so later test files (which read loadIndexes() at import)
// don't inherit an empty/fixture docMap. Module state is process-global under bun.
afterAll(() => {
  rebuildFromDisk();
});

function node(over: Partial<AtlasNode> = {}): AtlasNode {
  return {
    id: "id-1",
    doc_no: "A.1",
    title: "Node 1",
    type: "Core",
    depth: 1,
    parentId: null,
    order: 0,
    content: "hello world",
    addressRefs: [],
    ...over,
  };
}

describe("buildIndexes", () => {
  it("indexes docs by id and doc_no, and builds a sorted children index", () => {
    const root = node({ id: "root", doc_no: "A", parentId: null, order: 0 });
    const c2 = node({ id: "c2", doc_no: "A.2", parentId: "root", order: 2 });
    const c1 = node({ id: "c1", doc_no: "A.1", parentId: "root", order: 1 });
    const ix = buildIndexes([root, c2, c1], [], [], { atlasCommit: "test" });

    expect(ix.docMap.get("root")).toBe(root);
    expect(ix.byDocNo.get("A.2")).toBe(c2);
    // children sorted by `order`, not insertion order
    expect(ix.childrenIndex.get("root")!.map((d) => d.id)).toEqual(["c1", "c2"]);
  });

  it("builds a MiniSearch index from docs when no searchIndexJson is supplied, and it's searchable", () => {
    const a = node({ id: "a", title: "Savings Rate", content: "governance of the savings rate" });
    const ix = buildIndexes([a], [], [], { atlasCommit: "test" });
    const hits = ix.mini.search("savings");
    expect(hits.some((h) => h.id === "a")).toBe(true);
  });

  it("loads a prebuilt serialized searchIndexJson instead of re-tokenizing", () => {
    const a = node({ id: "a", title: "Savings Rate", content: "x" });
    const built = buildIndexes([a], [], [], { atlasCommit: "test" });
    const serialized = JSON.stringify(built.mini);
    const ix2 = buildIndexes([a], [], [], { atlasCommit: "test" }, serialized);
    expect(ix2.mini.search("savings").some((h) => h.id === "a")).toBe(true);
  });

  it("stamps generatedAt and appCommit when the artifact meta doesn't supply them", () => {
    const ix = buildIndexes([], [], [], { atlasCommit: "test" });
    expect(ix.meta.atlasCommit).toBe("test");
    expect(typeof ix.meta.generatedAt).toBe("string");
    // appCommit falls back to config.appCommit, which may be null in test env —
    // either way the key must be present (not silently dropped).
    expect("appCommit" in ix.meta).toBe(true);
  });

  it("honors an artifact-supplied appCommit/generatedAt instead of overwriting it", () => {
    const ix = buildIndexes([], [], [], { atlasCommit: "test", appCommit: "abc123", generatedAt: "2020-01-01T00:00:00.000Z" });
    expect(ix.meta.appCommit).toBe("abc123");
    expect(ix.meta.generatedAt).toBe("2020-01-01T00:00:00.000Z");
  });

  it("builds a glossary lookup from glossaryTerms, empty when omitted", () => {
    const withGlossary = buildIndexes([], [], [], { atlasCommit: "test" }, null, {
      widget: [{ term: "Widget", definition: "A thing.", docId: "d1" } as never],
    });
    expect(withGlossary.glossary.has("widget")).toBe(true);

    const noGlossary = buildIndexes([], [], [], { atlasCommit: "test" });
    expect(noGlossary.glossary.size).toBe(0);
  });
});

describe("buildGraph", () => {
  const entity: Entity = {
    id: "e1",
    slug: "spark",
    name: "Spark",
    entity_type: "ecosystem_actor",
    subtype: null,
    defining_doc_id: null,
    is_active: 1,
    meta: null,
  };

  it("adds every doc and entity as a node, and edges carry full attrs", () => {
    const d = node({ id: "d1" });
    const edge: Edge = {
      id: 1,
      from_id: "d1",
      from_type: "doc",
      to_id: "e1",
      to_type: "entity",
      edge_type: "mentions",
      source_doc_nos: "A.1",
      weight: 1,
      meta: null,
    };
    const { graph, entityBySlug, entityById } = buildGraph([d], [entity], [edge]);
    expect(graph.hasNode("d1")).toBe(true);
    expect(graph.hasNode("e1")).toBe(true);
    expect(graph.hasDirectedEdge("d1", "e1")).toBe(true);
    expect(graph.getEdgeAttribute("1", "edge_type")).toBe("mentions");
    expect(entityBySlug.get("spark")).toBe(entity);
    expect(entityById.get("e1")).toBe(entity);
  });

  it("adds a node for an edge endpoint that is neither a known doc nor a known entity", () => {
    const edge: Edge = {
      id: 2,
      from_id: "addr1",
      from_type: "address",
      to_id: "e1",
      to_type: "entity",
      edge_type: "controls",
      source_doc_nos: null,
      weight: 1,
      meta: null,
    };
    const { graph } = buildGraph([], [entity], [edge]);
    expect(graph.hasNode("addr1")).toBe(true);
    expect(graph.getNodeAttribute("addr1", "_nt")).toBe("address");
  });
});

describe("docRowToNode", () => {
  it("fills defaults for a bare row (no content, order, contentHash, addressRefs)", () => {
    const row: DocMetaRow = {
      id: "x",
      doc_no: "A.1",
      title: "T",
      type: "Core",
      depth: 1,
      parentId: null,
      content: null,
      order: 0,
    };
    const n = docRowToNode(row);
    expect(n.content).toBe("");
    expect(n.contentHash).toBeUndefined();
    expect(n.addressRefs).toEqual([]);
  });

  it("passes through populated optional fields", () => {
    const row: DocMetaRow = {
      id: "x",
      doc_no: "A.1",
      title: "T",
      type: "Core",
      depth: 1,
      parentId: "p",
      content: "body",
      order: 3,
      contentHash: "hash1",
      addressRefs: ["0xabc"],
    };
    const n = docRowToNode(row);
    expect(n.parentId).toBe("p");
    expect(n.contentHash).toBe("hash1");
    expect(n.addressRefs).toEqual(["0xabc"]);
  });
});

describe("writeDocsJson / writeDocsSplit", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "idx-test-"));
  });

  it("writeDocsJson emits the {atlasCommit, nodes} envelope", () => {
    const nodes = { a: node({ id: "a" }) };
    writeDocsJson(dir, "sha123", nodes);
    const out = JSON.parse(readFileSync(join(dir, "docs.json"), "utf8"));
    expect(out.atlasCommit).toBe("sha123");
    expect(out.nodes.a.id).toBe("a");
  });

  it("writeDocsSplit partitions by depth (<=5 shallow, >5 deep) and strips contentHash", () => {
    const shallow = node({ id: "s", depth: 5, contentHash: "h1" });
    const deep = node({ id: "d", depth: 6, contentHash: "h2" });
    writeDocsSplit(dir, "sha123", { s: shallow, d: deep });

    const shallowOut = JSON.parse(readFileSync(join(dir, "docs-shallow.json"), "utf8"));
    const deepOut = JSON.parse(readFileSync(join(dir, "docs-deep.json"), "utf8"));

    expect(shallowOut.nodes.map((n: AtlasNode) => n.id)).toEqual(["s"]);
    expect(deepOut.nodes.map((n: AtlasNode) => n.id)).toEqual(["d"]);
    // contentHash is server-only — stripped from the browser-facing split.
    expect("contentHash" in shallowOut.nodes[0]).toBe(false);
    expect("contentHash" in deepOut.nodes[0]).toBe(false);
  });

  it("cleans up temp dir", () => {
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("readArtifactsFromDisk", () => {
  it("reads the real built artifacts from public/ and returns non-empty docs/entities/edges", () => {
    const art = readArtifactsFromDisk();
    expect(art.docs.length).toBeGreaterThan(0);
    expect(Array.isArray(art.entities)).toBe(true);
    expect(Array.isArray(art.edges)).toBe(true);
    expect(art.meta.atlasCommit).toBeTruthy();
    expect(typeof art.searchIndexJson === "string" || art.searchIndexJson === null).toBe(true);
  });

  it("returns EMPTY_ARTIFACTS when docs.json/graph.json are missing (cold start before worker sync)", () => {
    const prevDir = config.publicDir;
    const dir = mkdtempSync(join(tmpdir(), "idx-cold-"));
    config.publicDir = dir;
    try {
      const art = readArtifactsFromDisk();
      expect(art).toEqual({ docs: [], entities: [], edges: [], meta: {}, searchIndexJson: null, glossaryTerms: null });
    } finally {
      config.publicDir = prevDir;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("degrades gracefully when search-index.json / glossary.json are missing but docs.json/graph.json exist", () => {
    const prevDir = config.publicDir;
    const dir = mkdtempSync(join(tmpdir(), "idx-partial-"));
    const n = node({ id: "d1" });
    writeDocsJson(dir, "sha-partial", { d1: n });
    writeFileSync(join(dir, "graph.json"), JSON.stringify({ meta: { atlasCommit: "sha-partial" }, entities: [], edges: [] }));
    config.publicDir = dir;
    try {
      const art = readArtifactsFromDisk();
      expect(art.docs.map((d) => d.id)).toEqual(["d1"]);
      expect(art.searchIndexJson).toBeNull();
      expect(art.glossaryTerms).toBeNull();
      expect(art.meta.atlasCommit).toBe("sha-partial");
    } finally {
      config.publicDir = prevDir;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("loadIndexes / setIndexes / getIndexes", () => {
  // IMPORTANT ORDERING NOTE: `state` in indexes.ts is module-level and shared
  // across every test file in this `bun test` run. This describe block is
  // the first (alphabetically-earliest test file's first consumer) to touch
  // that state, so this first test genuinely exercises the fresh/first-load
  // path of loadIndexes() (reading real artifacts off disk) before anything
  // else in the run has called loadIndexes()/setIndexes(). Keep it first.
  it("loadIndexes() on a fresh module reads real artifacts off disk and memoizes", () => {
    const first = loadIndexes();
    expect(first.docMap.size).toBeGreaterThan(0);
    const second = loadIndexes();
    expect(second).toBe(first); // memoized — no second disk read
  });

  it("getIndexes reflects whatever setIndexes last installed", () => {
    const ix = buildIndexes([], [], [], { atlasCommit: "t" });
    setIndexes(ix);
    expect(getIndexes()).toBe(ix);
  });

  it("rebuildFromDisk re-reads artifacts and atomically swaps + returns the new index set", () => {
    const before = buildIndexes([node({ id: "sentinel" })], [], [], { atlasCommit: "sentinel" });
    setIndexes(before);
    const rebuilt = rebuildFromDisk();
    expect(rebuilt).not.toBe(before);
    expect(getIndexes()).toBe(rebuilt); // swap actually happened
    expect(rebuilt.docMap.size).toBeGreaterThan(0); // real artifacts, not the sentinel
  });

  it("setIndexes atomically swaps the live state returned by getIndexes", () => {
    const a = buildIndexes([node({ id: "a" })], [], [], { atlasCommit: "a" });
    const b = buildIndexes([node({ id: "b" })], [], [], { atlasCommit: "b" });
    setIndexes(a);
    expect(getIndexes()).toBe(a);
    setIndexes(b);
    expect(getIndexes()).toBe(b);
  });
});

describe("resolveNode", () => {
  it("resolves by UUID first, falling back to doc_no", () => {
    const a = node({ id: "uuid-a", doc_no: "A.1" });
    const ix = buildIndexes([a], [], [], { atlasCommit: "t" });
    expect(resolveNode(ix, "uuid-a")).toBe(a);
    expect(resolveNode(ix, "A.1")).toBe(a);
    expect(resolveNode(ix, "nope")).toBeUndefined();
  });
});

describe("ancestorChain", () => {
  it("walks parent -> ... -> root, excluding the node itself", () => {
    const root = node({ id: "root", parentId: null, depth: 1 });
    const mid = node({ id: "mid", parentId: "root", depth: 2 });
    const leaf = node({ id: "leaf", parentId: "mid", depth: 3 });
    const ix = buildIndexes([root, mid, leaf], [], [], { atlasCommit: "t" });
    const chain = ancestorChain(ix, "leaf");
    expect(chain.map((a) => a.id)).toEqual(["mid", "root"]);
  });

  it("stops (doesn't loop forever) when parent pointers cycle", () => {
    const a = node({ id: "a", parentId: "b" });
    const b = node({ id: "b", parentId: "a" });
    const ix = buildIndexes([a, b], [], [], { atlasCommit: "t" });
    const chain = ancestorChain(ix, "a");
    // Walks a -> b -> a, then the second "a" is already seen and stops (no
    // infinite loop) — both nodes are visited once before the cycle bails.
    expect(chain.map((x) => x.id)).toEqual(["b", "a"]);
  });

  it("returns [] for a node with no parent, and [] for an unknown id", () => {
    const root = node({ id: "root", parentId: null });
    const ix = buildIndexes([root], [], [], { atlasCommit: "t" });
    expect(ancestorChain(ix, "root")).toEqual([]);
    expect(ancestorChain(ix, "missing")).toEqual([]);
  });
});

describe("descendantIds", () => {
  it("collects the node itself plus every descendant, deduped", () => {
    const root = node({ id: "root", parentId: null });
    const c1 = node({ id: "c1", parentId: "root" });
    const c2 = node({ id: "c2", parentId: "root" });
    const gc = node({ id: "gc", parentId: "c1" });
    const ix = buildIndexes([root, c1, c2, gc], [], [], { atlasCommit: "t" });
    const ids = descendantIds(ix, "root");
    expect([...ids].sort()).toEqual(["c1", "c2", "gc", "root"]);
  });

  it("returns just the root id for a leaf with no children", () => {
    const leaf = node({ id: "leaf", parentId: null });
    const ix = buildIndexes([leaf], [], [], { atlasCommit: "t" });
    expect([...descendantIds(ix, "leaf")]).toEqual(["leaf"]);
  });
});
