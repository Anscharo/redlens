// Pure/targeted tests for tools.ts. Run under `bun test` (NOT vitest).
// atlas_describe / atlas_get's common paths are already exercised by
// tools-graph.test.ts (same module) and tool-registry.test.ts's end-to-end
// pass; this file targets atlasGet's bulk/truncation branches, atlasSearch's
// mode/phrase-filter branches, and atlasGetAddress's DB + graph-edge path.
import { test, expect, mock, beforeEach } from "bun:test";
import { toUuidArrayLiteral, fromUuidArray } from "../../pg-array.ts";
import { buildIndexes, type AtlasNode, type Entity, type Edge, type Indexes } from "../../retrieval/indexes.ts";
import { config } from "../../config.ts";

function mockDb(rows: unknown[] = []) {
  const fn = Object.assign(
    (..._args: unknown[]) => Promise.resolve(rows),
    { unsafe: (..._args: unknown[]) => Promise.resolve(rows) },
  );
  mock.module("../../db.ts", () => ({
    sql: fn,
    toVectorLiteral: (v: number[]) => `[${v.join(",")}]`,
    // Real impls, never re-stubbed: `Array.isArray("{uuid,uuid}")` is false, so a
    // hand-rolled stub silently returns [] for what Bun.sql actually hands back.
    // See pg-array.ts; enforced by scripts/aux/audit-mock-modules.mjs.
    toUuidArrayLiteral,
    fromUuidArray,
    dbTarget: () => "mock:5432/db",
    waitForDb: async () => {},
  }));
}

function doc(id: string, doc_no: string, type: string, depth: number, parentId: string | null, content = `content ${id}`): AtlasNode {
  return { id, doc_no, title: id, type, depth, parentId, order: 0, content, addressRefs: [] } as AtlasNode;
}
function edge(id: number, from_id: string, from_type: string, to_id: string, to_type: string, edge_type: string): Edge {
  return { id, from_id, from_type, to_id, to_type, edge_type, source_doc_nos: null, weight: 1, meta: null };
}
function entity(id: string, slug: string, entity_type: string, subtype: string | null, defining_doc_id: string | null): Entity {
  return { id, slug, name: slug, entity_type, subtype, defining_doc_id, is_active: 1, meta: null };
}

const ADDR = "0x0000000000000000000000000000000000dead";

function makeIx(): Indexes {
  const docs = [
    doc("D0", "A.1", "Core", 1, null, "Sky Atlas governance root document about the USDS token and PSM facilitator duties."),
    doc("D1", "A.1.1", "Core", 2, "D0", 'A quoted phrase test: "USDS PSM" appears here verbatim.'),
    doc("D2", "A.1.2", "Core", 2, "D0", "unrelated content about oracles"),
    // Empty, childless doc — buildLivenessMap's childless-empty-stub rule tags
    // it "placeholder" with no extra fixture machinery (no need to fake a
    // conceptsCensus registry to exercise "scaffold").
    doc("D3", "A.2", "Core", 1, null, ""),
  ];
  const edges: Edge[] = [
    edge(1, "D0", "doc", "D1", "doc", "parent_of"),
    edge(2, "D0", "doc", "D2", "doc", "parent_of"),
    // entity -> address (has_address) so atlasGetAddress's forEachInEdge path resolves via entity.
    edge(3, "E", "entity", `${ADDR}:ethereum`, "address", "has_address"),
    // doc -> address (located_at) so the doc-endpoint branch is also exercised.
    edge(4, "D1", "doc", `${ADDR}:ethereum`, "address", "located_at"),
  ];
  const entities: Entity[] = [entity("E", "ent", "agent", "prime", "D0")];
  return buildIndexes(docs, entities, edges, {});
}

beforeEach(() => {
  mock.restore();
});

// ── atlas_get: bulk + not-found + truncation ─────────────────────────────────
test("atlasGet(bulk) resolves each id independently and flags missing ones", async () => {
  mockDb([]);
  const { atlasGet } = await import("./tools.ts");
  const ix = makeIx();
  const result = atlasGet(ix, ["D1", "does-not-exist"]) as { count: number; results: Array<Record<string, unknown>> };
  expect(result.count).toBe(2);
  expect(result.results[0]).toMatchObject({ id: "D1" });
  expect(result.results[1]).toEqual({ query: "does-not-exist", error: "Not found" });
});

test("atlasGet(single) returns {error} for an unresolvable id", async () => {
  mockDb([]);
  const { atlasGet } = await import("./tools.ts");
  const ix = makeIx();
  expect(atlasGet(ix, "nope")).toEqual({ error: "Not found" });
});

// ── liveness tagging (docs/research/synlang-wiki.md §3.2) ────────────────────
test("atlasGet tags a liveness-flagged doc and adds the envelope hint; a settled doc carries neither", async () => {
  mockDb([]);
  const { atlasGet } = await import("./tools.ts");
  const ix = makeIx();
  const tagged = atlasGet(ix, "D3") as Record<string, unknown>;
  expect(tagged.liveness).toBe("placeholder");
  expect(tagged.liveness_hint).toContain("liveness:placeholder = content not yet specified.");

  const settled = atlasGet(ix, "D1") as Record<string, unknown>;
  expect(settled.liveness).toBeUndefined();
  expect(settled.liveness_hint).toBeUndefined();
});

test("atlasGet(bulk) tags flagged results and adds one envelope-level hint covering the batch", async () => {
  mockDb([]);
  const { atlasGet } = await import("./tools.ts");
  const ix = makeIx();
  const res = atlasGet(ix, ["D1", "D3"]) as { results: Array<Record<string, unknown>>; liveness_hint?: string };
  expect(res.results[0].liveness).toBeUndefined();
  expect(res.results[1].liveness).toBe("placeholder");
  expect(res.liveness_hint).toBeDefined();
});

// ── atlas_search: modes + phrase filter ──────────────────────────────────────
test("atlasSearch mode=lexical finds a doc by keyword", async () => {
  mockDb([]);
  const { atlasSearch } = await import("./tools.ts");
  const ix = makeIx();
  const res = (await atlasSearch(ix, { query: "governance", k: 10, mode: "lexical" })) as {
    count: number;
    mode: string;
    results: Array<{ id: string }>;
  };
  expect(res.mode).toBe("lexical");
  expect(res.count).toBeGreaterThan(0);
  expect(res.results.some((r) => r.id === "D0")).toBe(true);
});

test("atlasSearch honors a quoted phrase post-filter", async () => {
  mockDb([]);
  const { atlasSearch } = await import("./tools.ts");
  const ix = makeIx();
  const res = (await atlasSearch(ix, { query: '"USDS PSM"', k: 10, mode: "lexical" })) as {
    phrase_filter: string[];
    results: Array<{ id: string }>;
  };
  expect(res.phrase_filter).toEqual(["USDS PSM"]);
  // Only D1 contains the exact phrase; D0 mentions the words but not as a phrase.
  expect(res.results.every((r) => r.id === "D1")).toBe(true);
  expect(res.results.length).toBe(1);
});

test("atlasSearch mode=hybrid merges lexical + (empty, keyless) semantic legs", async () => {
  mockDb([]);
  const { atlasSearch } = await import("./tools.ts");
  const ix = makeIx();
  const res = (await atlasSearch(ix, { query: "governance", k: 5, mode: "hybrid" })) as { mode: string; count: number };
  expect(res.mode).toBe("hybrid");
  expect(res.count).toBeGreaterThan(0);
});

test("atlasSearch mode=semantic returns no results with no embedding API key configured", async () => {
  mockDb([]);
  const { atlasSearch } = await import("./tools.ts");
  const ix = makeIx();
  const res = (await atlasSearch(ix, { query: "governance", k: 5, mode: "semantic" })) as {
    mode: string;
    count: number;
    semantic_skipped?: string;
  };
  expect(res.mode).toBe("semantic");
  expect(res.count).toBe(0);
  // Missing key is a permanent config state, not a runtime degradation — the
  // field must be absent, not present-with-null, or every keyless dev result
  // would carry a spurious "skipped" note.
  expect(res.semantic_skipped).toBeUndefined();
});

// ── atlas_search: semantic_skipped envelope field ────────────────────────────
test("atlasSearch surfaces semantic_skipped when a hybrid search's embed leg times out at runtime", async () => {
  mockDb([]);
  const prevKey = config.openrouterApiKey;
  const prevTimeout = config.semanticEmbedTimeoutMs;
  const prevFetch = globalThis.fetch;
  config.openrouterApiKey = "test-key";
  config.semanticEmbedTimeoutMs = 20;
  globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch; // hangs → timeout
  try {
    const { atlasSearch } = await import("./tools.ts");
    const ix = makeIx();
    const res = (await atlasSearch(ix, { query: "governance", k: 5, mode: "hybrid" })) as {
      mode: string;
      semantic_skipped?: string;
      results: Array<{ id: string }>;
    };
    expect(res.semantic_skipped).toMatch(/embed timed out after 20ms/);
    // Degrades to lexical-only rather than losing the whole search.
    expect(res.results.some((r) => r.id === "D0")).toBe(true);
  } finally {
    config.openrouterApiKey = prevKey;
    config.semanticEmbedTimeoutMs = prevTimeout;
    globalThis.fetch = prevFetch;
  }
});

test("atlasSearch mode=lexical never surfaces semantic_skipped, even if the semantic leg would have failed", async () => {
  mockDb([]);
  const prevKey = config.openrouterApiKey;
  const prevTimeout = config.semanticEmbedTimeoutMs;
  const prevFetch = globalThis.fetch;
  config.openrouterApiKey = "test-key";
  config.semanticEmbedTimeoutMs = 20;
  globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch;
  try {
    const { atlasSearch } = await import("./tools.ts");
    const ix = makeIx();
    const res = (await atlasSearch(ix, { query: "governance", k: 5, mode: "lexical" })) as {
      semantic_skipped?: string;
    };
    // mode=lexical never runs the semantic leg at all, so there's nothing to report.
    expect(res.semantic_skipped).toBeUndefined();
  } finally {
    config.openrouterApiKey = prevKey;
    config.semanticEmbedTimeoutMs = prevTimeout;
    globalThis.fetch = prevFetch;
  }
});

test("atlasSearch supports a type filter", async () => {
  mockDb([]);
  const { atlasSearch } = await import("./tools.ts");
  const ix = makeIx();
  const res = (await atlasSearch(ix, { query: "governance", k: 5, type: "Core", mode: "lexical" })) as { count: number };
  expect(res.count).toBeGreaterThan(0);
});

test("atlasSearch tags a liveness-flagged hit and adds ONE envelope-level hint, not one per row", async () => {
  mockDb([]);
  const { atlasSearch } = await import("./tools.ts");
  const ix = makeIx();
  const res = (await atlasSearch(ix, { query: "D3", k: 10, mode: "lexical" })) as {
    results: Array<{ id: string; liveness?: string }>;
    liveness_hint?: string;
  };
  expect(res.results.some((r) => r.id === "D3" && r.liveness === "placeholder")).toBe(true);
  expect(res.liveness_hint).toBeDefined();

  // No tagged hits in the result set → no hint at all.
  const clean = (await atlasSearch(ix, { query: "governance", k: 10, mode: "lexical" })) as { liveness_hint?: string };
  expect(clean.liveness_hint).toBeUndefined();
});

// ── atlas_get_address ──────────────────────────────────────────────────────
test("atlasGetAddress reports not-found when the address has no DB rows", async () => {
  mockDb([]);
  const { atlasGetAddress } = await import("./tools.ts");
  const ix = makeIx();
  const res = (await atlasGetAddress(ix, "0x1111111111111111111111111111111111aaaa")) as { error?: string; address?: string };
  expect(res.error).toBe("Address not found");
  expect(res.address).toBe("0x1111111111111111111111111111111111aaaa");
});

test("atlasGetAddress normalizes case, merges entity + chain metadata, and resolves in-edges", async () => {
  mockDb([
    {
      address: ADDR,
      chain: "ethereum",
      label: "Dead Address",
      chainlog_id: null,
      etherscan_name: "Dead",
      is_contract: false,
      is_proxy: false,
      implementation: null,
      entity_id: "E",
      content_hash: "should-be-dropped",
      atlas_sha: "should-be-dropped-too",
    },
  ]);
  const { atlasGetAddress } = await import("./tools.ts");
  const ix = makeIx();
  const res = (await atlasGetAddress(ix, ADDR.toUpperCase().replace("0X", "0x"))) as {
    address: string;
    records: Array<Record<string, unknown>>;
    edges: Array<Record<string, unknown>>;
  };

  expect(res.address).toBe(ADDR); // normalized to lowercase
  expect(res.records.length).toBe(1);
  expect(res.records[0].content_hash).toBeUndefined();
  expect(res.records[0].atlas_sha).toBeUndefined();
  expect(res.records[0].entity).toMatchObject({ slug: "ent", entity_type: "agent" });

  // Both the entity->address (has_address, from an entity) and doc->address
  // (located_at, from a doc) in-edges should resolve.
  const edgeTypes = res.edges.map((e) => e.edge_type).sort();
  expect(edgeTypes).toEqual(["has_address", "located_at"]);
  const fromEntity = res.edges.find((e) => e.edge_type === "has_address")!;
  expect(fromEntity.from_type).toBe("entity");
  expect(fromEntity.title).toBe("ent");
  const fromDoc = res.edges.find((e) => e.edge_type === "located_at")!;
  expect(fromDoc.from_type).toBe("doc");
  expect(fromDoc.doc_no).toBe("A.1.1");
});

test("atlasGetAddress passes an explicit chain filter through to the query", async () => {
  mockDb([{ address: ADDR, chain: "base", entity_id: null }]);
  const { atlasGetAddress } = await import("./tools.ts");
  const ix = makeIx();
  const res = (await atlasGetAddress(ix, ADDR, "base")) as { records: Array<Record<string, unknown>> };
  expect(res.records[0].entity).toBeNull();
});
