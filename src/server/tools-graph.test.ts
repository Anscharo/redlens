// Pure tool-layer unit tests for the graph tools. Run under `bun test` (NOT
// vitest) — src/server is excluded from vitest. These functions are fully
// in-memory (no SQL), so a hand-built Indexes fixture is enough.
import { test, expect } from "bun:test";
import { atlasTraverse, atlasEntity, atlasEntityParams } from "./tools-graph.ts";
import type { Indexes, AtlasNode, Edge, Entity } from "./indexes.ts";

// ── Fixture ──────────────────────────────────────────────────────────────
// Subtree under D0:  D0 ─┬─ D1 (instance: distribution-reward) ─┬─ P1
//                        │                                       └─ P2
//                        └─ D2 (instance: allocation-system, Active Data) ─ P3
// Plus a cites edge D1 → DX (out of subtree), and E ─defines_entity→ D0.
function node(id: string, doc_no: string, type: string, depth: number, parentId: string | null): AtlasNode {
  return { id, doc_no, title: id, type, depth, parentId, order: 0, content: `content ${id}`, addressRefs: [] } as AtlasNode;
}
function edge(id: number, from_id: string, to_id: string, edge_type: string): Edge {
  return { id, from_id, from_type: "doc", to_id, to_type: "doc", edge_type, source_doc_nos: null, weight: 1, meta: null };
}
function entity(id: string, slug: string, entity_type: string, subtype: string | null, defining_doc_id: string): Entity {
  return { id, slug, name: slug, entity_type, subtype, defining_doc_id, is_active: 1, meta: null };
}

function makeIx(): Indexes {
  const docs = [
    node("D0", "A.1", "Core", 1, null),
    node("D1", "A.1.1", "Core", 2, "D0"),
    node("D2", "A.1.2", "Active Data", 2, "D0"),
    node("P1", "A.1.1.1", "Core", 3, "D1"),
    node("P2", "A.1.1.2", "Core", 3, "D1"),
    node("P3", "A.1.2.1", "Core", 3, "D2"),
    node("DX", "A.9", "Core", 1, null),
  ];
  const docMap = new Map(docs.map((d) => [d.id, d]));
  const byDocNo = new Map(docs.map((d) => [d.doc_no, d]));
  const childrenIndex = new Map<string, AtlasNode[]>();
  for (const d of docs) {
    if (!d.parentId) continue;
    const arr = childrenIndex.get(d.parentId);
    if (arr) arr.push(d);
    else childrenIndex.set(d.parentId, [d]);
  }
  const edges: Edge[] = [
    edge(1, "D0", "D1", "parent_of"),
    edge(2, "D0", "D2", "parent_of"),
    edge(3, "D1", "P1", "parent_of"),
    edge(4, "D1", "P2", "parent_of"),
    edge(5, "D2", "P3", "parent_of"),
    edge(6, "D1", "DX", "cites"),
    { ...edge(7, "E", "D0", "defines_entity"), from_type: "entity" },
  ];
  const entities: Entity[] = [
    entity("E", "ent", "agent", "prime", "D0"),
    entity("IE1", "ent-distribution-reward", "instance", "distribution-reward", "D1"),
    entity("IE2", "ent-allocation-system", "instance", "allocation-system", "D2"),
  ];
  return {
    docMap,
    byDocNo,
    childrenIndex,
    edges,
    entities,
    entityBySlug: new Map(entities.map((e) => [e.slug, e])),
    entityById: new Map(entities.map((e) => [e.id, e])),
  } as unknown as Indexes;
}

// ── atlas_traverse: hops + edge_type + direction ────────────────────────────
test("atlas_traverse reports hops (not depth), plus edge_type and direction", () => {
  const ix = makeIx();
  const res = atlasTraverse(ix, "D1", undefined, 1, "both") as { results: Array<Record<string, unknown>> };
  const by = new Map(res.results.map((r) => [r.id, r]));

  // Children reached outbound via parent_of.
  expect(by.get("P1")).toMatchObject({ hops: 1, edge_type: "parent_of", direction: "out", depth: 3 });
  // Cross-reference reached outbound via cites.
  expect(by.get("DX")).toMatchObject({ hops: 1, edge_type: "cites", direction: "out" });
  // Parent reached inbound via parent_of.
  expect(by.get("D0")).toMatchObject({ hops: 1, edge_type: "parent_of", direction: "in", depth: 1 });
  // `hops` is BFS distance, `depth` is the node's real atlas depth — never conflated.
  expect(by.get("P1")!.hops).not.toBe(by.get("P1")!.depth);
});

// ── atlas_entity: pagination + type histogram + size guard ───────────────────
test("atlas_entity paginates nodes and reports node_count + node_types", () => {
  const ix = makeIx();
  const first = atlasEntity(ix, "ent", { limit: 2, offset: 0, include_content: false }) as Record<string, unknown>;
  // Full set = subtree {D0,D1,D2,P1,P2,P3} (6 docs; D0 also arrives via edge, deduped).
  expect(first.node_count).toBe(6);
  expect(first.node_types).toMatchObject({ Core: 5, "Active Data": 1 });
  expect((first.nodes as unknown[]).length).toBe(2);
  expect(first.has_more).toBe(true);

  const typed = atlasEntity(ix, "ent", { type: "Active Data", limit: 50, offset: 0, include_content: false }) as Record<string, unknown>;
  expect(typed.node_count).toBe(1);
  expect((typed.nodes as Array<{ id: string }>)[0].id).toBe("D2");

  expect((atlasEntity(ix, "missing", { limit: 50, offset: 0, include_content: false }) as { error?: string }).error).toBeDefined();
});

// ── atlas_entity_params: instance selection + subtype filter ─────────────────
test("atlas_entity_params(entity) selects instance docs and filters by subtype", () => {
  const ix = makeIx();
  const all = atlasEntityParams(ix, { entity: "ent", limit: 50 }) as {
    instances: Array<{ id: string }>;
    available_subtypes: string[];
  };
  // Two instance docs (D1, D2), not the whole 6-node subtree.
  expect(all.instances.map((i) => i.id).sort()).toEqual(["D1", "D2"]);
  expect(all.available_subtypes).toEqual(["allocation-system", "distribution-reward"]);

  // type_hint matches the SUBTYPE as a case-insensitive substring.
  const reward = atlasEntityParams(ix, { entity: "ent", type_hint: "reward", limit: 50 }) as { instances: Array<{ id: string; params: unknown[] }> };
  expect(reward.instances.map((i) => i.id)).toEqual(["D1"]);
  expect(reward.instances[0].params.length).toBe(2); // P1, P2

  // id path returns that one doc's params, no available_subtypes.
  const byId = atlasEntityParams(ix, { id: "D2", limit: 50 }) as { instances: Array<{ id: string }>; available_subtypes?: string[] };
  expect(byId.instances.map((i) => i.id)).toEqual(["D2"]);
  expect(byId.available_subtypes).toBeUndefined();
});
