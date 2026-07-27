// atlasQuery integration-ish tests over an in-memory index built with
// buildIndexes (no DB, no live artifacts) — mirrors entity-resolve.test.ts's
// fixture style. Every case here deliberately avoids the DB-touching paths
// (history filters need Postgres; the semantic search leg needs
// config.openrouterApiKey, which is unset in this test env and short-circuits
// runSemantic to []), so atlasQuery only exercises pure in-memory logic.
// Run under `bun test`.
import { describe, it, expect } from "bun:test";
import { buildIndexes, type AtlasNode, type Entity, type Edge } from "./indexes.ts";
import { atlasQuery } from "./query.ts";

function node(over: Partial<AtlasNode> = {}): AtlasNode {
  return {
    id: "n-1",
    doc_no: "A.1",
    title: "Node",
    type: "Core",
    depth: 2,
    parentId: null,
    order: 0,
    content: "content",
    addressRefs: [],
    ...over,
  };
}

function entity(over: Partial<Entity> = {}): Entity {
  return {
    id: "e-1",
    slug: "spark",
    name: "Spark",
    entity_type: "ecosystem_actor",
    subtype: null,
    defining_doc_id: null,
    is_active: 1,
    meta: null,
    ...over,
  };
}

let nextEdgeId = 1;
function edge(over: Partial<Edge>): Edge {
  return {
    id: nextEdgeId++,
    from_id: "",
    from_type: "entity",
    to_id: "",
    to_type: "doc",
    edge_type: "mentions",
    source_doc_nos: null,
    weight: 1,
    meta: null,
    ...over,
  };
}

// Shared fixture: two entities linked (spark -> keeper-network), each with a
// responsibility doc, plus a standalone "Primitive Instance" doc for
// target_type-only queries, and a root/child pair for ancestor_id.
function buildFixture() {
  const root = node({ id: "root", doc_no: "A", title: "Root Scope", type: "Scope", depth: 1, parentId: null, order: 0, content: "root content" });
  const sparkDoc = node({ id: "spark-doc", doc_no: "A.1", title: "Spark Responsibility", type: "Core", depth: 2, parentId: "root", order: 1, content: "Spark handles the Savings Rate. Status: Active." });
  const keeperDoc = node({ id: "keeper-doc", doc_no: "A.2", title: "Keeper Network Data Report", type: "Core", depth: 2, parentId: "root", order: 2, content: "Keeper Network reports usage data. Status: Inactive." });
  const primitiveDoc = node({ id: "prim-1", doc_no: "A.3", title: "Some Primitive", type: "Primitive Instance", depth: 2, parentId: "root", order: 3, content: "a primitive instance" });
  const childOfSpark = node({ id: "spark-child", doc_no: "A.1.1", title: "Spark Child", type: "Core", depth: 3, parentId: "spark-doc", order: 1, content: "child content" });

  const spark = entity({ id: "spark-ent", slug: "spark", name: "Spark", entity_type: "ecosystem_actor" });
  const keeper = entity({ id: "keeper-ent", slug: "keeper-network", name: "Keeper Network", entity_type: "ecosystem_actor" });

  const edges: Edge[] = [
    edge({ from_id: "spark-ent", from_type: "entity", to_id: "spark-doc", to_type: "doc", edge_type: "responsible_party_for" }),
    edge({ from_id: "keeper-ent", from_type: "entity", to_id: "keeper-doc", to_type: "doc", edge_type: "active_data_for" }),
    edge({ from_id: "spark-ent", from_type: "entity", to_id: "keeper-ent", to_type: "entity", edge_type: "delegates_to" }),
    // doc -> entity edge, so direction "in" (entity as the to_type) has
    // something to find pointing INTO keeper-ent.
    edge({ from_id: "spark-doc", from_type: "doc", to_id: "keeper-ent", to_type: "entity", edge_type: "cites_entity" }),
  ];

  const docs = [root, sparkDoc, keeperDoc, primitiveDoc, childOfSpark];
  const entities = [spark, keeper];
  const ix = buildIndexes(docs, entities, edges, { atlasCommit: "test" });
  return { ix, root, sparkDoc, keeperDoc, primitiveDoc, childOfSpark, spark, keeper };
}

describe("atlasQuery — validation", () => {
  it("errors when none of q/entity/target_type are given", async () => {
    const { ix } = buildFixture();
    const res = await atlasQuery(ix, { k: 10, enrich: false });
    expect(res.error).toMatch(/at least one of/);
  });

  it("errors when the entity doesn't resolve to anything", async () => {
    const { ix } = buildFixture();
    const res = await atlasQuery(ix, { entity: "totally-unknown-thing-xyz", k: 10, enrich: false });
    expect(res.error).toMatch(/No entity matches/);
  });
});

describe("atlasQuery — entity_chain", () => {
  it("walks entity -> entities of via_entity_type -> their docs", async () => {
    const { ix } = buildFixture();
    const res = await atlasQuery(ix, { entity: "spark", via_entity_type: "ecosystem_actor", k: 10, enrich: false });
    expect(res.mode).toBe("entity_chain");
    expect(res.resolved_entity).toMatchObject({ slug: "spark" });
    const ids = (res.results as { id: string }[]).map((r) => r.id);
    // keeper-ent is an ecosystem_actor reachable from spark via delegates_to;
    // its responsibility doc (keeper-doc) should surface.
    expect(ids).toContain("keeper-doc");
  });
});

describe("atlasQuery — entity_broad", () => {
  it("groups an entity's connected docs by edge_type when no q/edge_types given", async () => {
    const { ix } = buildFixture();
    const res = await atlasQuery(ix, { entity: "spark", k: 10, enrich: false });
    expect(res.mode).toBe("entity_broad");
    const byRel = res.by_relationship as Record<string, { id: string }[]>;
    expect(byRel.responsible_party_for.map((r) => r.id)).toContain("spark-doc");
    // delegates_to (entity->entity) shouldn't leak in as a doc relationship.
    expect(byRel.delegates_to).toBeUndefined();
  });

  it("respects direction: 'in' finds only doc edges pointing INTO this entity, not its own out edges", async () => {
    const { ix } = buildFixture();
    // keeper-ent's only doc->entity (in) edge is spark-doc --cites_entity-->
    // keeper-ent. Its own active_data_for edge (keeper-ent -> keeper-doc) is
    // outbound, so it must NOT appear under direction "in".
    const res = await atlasQuery(ix, { entity: "keeper-network", k: 10, enrich: false, direction: "in" });
    expect(res.mode).toBe("entity_broad");
    const byRel = res.by_relationship as Record<string, { id: string }[]>;
    expect(byRel.cites_entity.map((r) => r.id)).toContain("spark-doc");
    expect(byRel.active_data_for).toBeUndefined();
  });
});

describe("atlasQuery — type_list", () => {
  it("lists all docs of target_type when no entity/q given", async () => {
    const { ix } = buildFixture();
    const res = await atlasQuery(ix, { target_type: "Primitive Instance", k: 10, enrich: false });
    expect(res.mode).toBe("type_list");
    expect((res.results as { id: string }[]).map((r) => r.id)).toEqual(["prim-1"]);
  });
});

describe("atlasQuery — entity_narrow", () => {
  it("filters entity docs to a specific edge_type via edge_types (no q)", async () => {
    const { ix } = buildFixture();
    const res = await atlasQuery(ix, { entity: "spark", edge_types: ["responsible_party_for"], k: 10, enrich: false });
    expect(res.mode).toBe("entity_narrow");
    expect((res.results as { id: string }[]).map((r) => r.id)).toEqual(["spark-doc"]);
  });

  it("returns empty results (not an error) when edge_types matches nothing", async () => {
    const { ix } = buildFixture();
    const res = await atlasQuery(ix, { entity: "spark", edge_types: ["nonexistent_edge_type"], k: 10, enrich: false });
    expect(res.mode).toBe("entity_narrow");
    expect(res.results).toEqual([]);
    expect(res.count).toBe(0);
  });
});

describe("atlasQuery — search / hybrid_graph", () => {
  it("plain q performs lexical search (semantic leg is off — no OPENROUTER_API_KEY)", async () => {
    const { ix } = buildFixture();
    const res = await atlasQuery(ix, { q: "savings rate", k: 10, enrich: false });
    expect(res.mode).toBe("search");
    const ids = (res.results as { id: string }[]).map((r) => r.id);
    expect(ids).toContain("spark-doc");
    // Lean rows (enrich=false) carry a snippet, not full content.
    expect((res.results as { snippet?: string }[])[0].snippet).toBeDefined();
  });

  it("q + entity combined narrows to hybrid_graph mode, intersecting search hits with entity docs", async () => {
    const { ix } = buildFixture();
    // direction defaults to "both", so keeper-network's connected docs are
    // keeper-doc (its own active_data_for edge) AND spark-doc (inbound
    // cites_entity from spark-doc) — both also lexically match "active data"
    // (one term each via OR combine), so both should survive the intersection.
    const res = await atlasQuery(ix, { q: "active data", entity: "keeper-network", k: 10, enrich: false });
    expect(res.mode).toBe("hybrid_graph");
    const ids = (res.results as { id: string }[]).map((r) => r.id);
    expect(ids.sort()).toEqual(["keeper-doc", "spark-doc"]);
  });

  it("q + entity narrows to just the entity's own docs when edge_types pins a single relation", async () => {
    const { ix } = buildFixture();
    const res = await atlasQuery(ix, {
      q: "active data",
      entity: "keeper-network",
      edge_types: ["active_data_for"],
      k: 10,
      enrich: false,
    });
    expect(res.mode).toBe("hybrid_graph");
    const ids = (res.results as { id: string }[]).map((r) => r.id);
    expect(ids).toEqual(["keeper-doc"]);
  });

  it("enrich=true inlines full content + ancestor_ids and dedupes ancestors at the top level", async () => {
    const { ix } = buildFixture();
    const res = await atlasQuery(ix, { q: "savings rate", k: 10, enrich: true });
    const first = (res.results as { id: string; content?: string; ancestor_ids?: string[] }[])[0];
    expect(first.content).toBeDefined();
    expect(first.ancestor_ids).toContain("root");
    expect(res.ancestors).toBeDefined();
    expect((res.ancestors as Record<string, unknown>).root).toMatchObject({ doc_no: "A" });
  });

  it("include_params inlines immediate children as params", async () => {
    const { ix } = buildFixture();
    const res = await atlasQuery(ix, { q: "savings rate", k: 10, enrich: false, include_params: true });
    const first = (res.results as { id: string; params?: unknown[] }[])[0];
    expect(first.params).toEqual([expect.objectContaining({ id: "spark-child" })]);
  });

  it("quoted phrase in q requires the exact phrase (post-filter)", async () => {
    const { ix } = buildFixture();
    // "Savings Rate" appears in spark-doc; a phrase not present anywhere should
    // filter every hit away even if individual terms match.
    const res = await atlasQuery(ix, { q: '"totally absent phrase"', k: 10, enrich: false });
    expect(res.results).toEqual([]);
  });
});

describe("atlasQuery — status filter", () => {
  it("status filters to docs whose content/title word-boundary-matches the status token", async () => {
    const { ix } = buildFixture();
    const res = await atlasQuery(ix, { target_type: "Core", status: "Active", k: 10, enrich: false });
    const ids = (res.results as { id: string }[]).map((r) => r.id);
    expect(ids).toContain("spark-doc"); // "Status: Active."
    expect(ids).not.toContain("keeper-doc"); // "Status: Inactive." must not match /\bActive\b/
  });
});

describe("atlasQuery — ancestor_id filter", () => {
  it("restricts results to descendants of the given ancestor (UUID or doc_no)", async () => {
    const { ix } = buildFixture();
    const res = await atlasQuery(ix, { target_type: "Core", ancestor_id: "spark-doc", k: 10, enrich: false });
    const ids = (res.results as { id: string }[]).map((r) => r.id);
    // spark-doc itself is type Core and is its own descendant; spark-child is
    // type Core too but nested under it. keeper-doc is a sibling, excluded.
    expect(ids.sort()).toEqual(["spark-child", "spark-doc"]);
  });

  it("an unresolvable ancestor_id is ignored (no constraint), not a silent empty result", async () => {
    const { ix } = buildFixture();
    const res = await atlasQuery(ix, { target_type: "Primitive Instance", ancestor_id: "does-not-exist", k: 10, enrich: false });
    expect((res.results as { id: string }[]).map((r) => r.id)).toEqual(["prim-1"]);
  });
});
