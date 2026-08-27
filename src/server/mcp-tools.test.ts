// MCP tool-surface integration tests. Run under `bun test` (NOT vitest — these
// import Bun's SQL transitively). Builds a realistic in-memory atlas via
// buildIndexes and drives the tools through the SAME registry the MCP server
// and the chat loop use (tool-registry.ts), so wiring drift is caught here.
//
// DB-backed tools (atlas_get_address / atlas_history / atlas_recent_changes /
// atlas_history_stats / atlas_pr / atlas_changed_between / atlas_first_seen) need
// Postgres and are exercised by the "Railway server (Postgres + MCP smoke)" CI
// job, not here.
import { test, expect } from "bun:test";
import { z } from "zod";
import { ATLAS_TOOLS, TOOLS_BY_NAME } from "./chat/tools/tool-registry.ts";
import { EXTERNAL_TOOLS } from "./chat/tools/external-tools.ts";
import { buildIndexes, type AtlasNode, type Edge, type Entity } from "./retrieval/indexes.ts";

// ── Fixture ──────────────────────────────────────────────────────────────
//  A (Scope)
//  ├─ A.1 Aligned Delegates (Article)
//  │   └─ A.1.1 Delegate Responsibilities (Section, "zebraword")
//  │       └─ A.1.1.1 Voting Rules (Core, "voting zebraword")
//  └─ A.2 Spark (Article, entity defining doc)
//      ├─ A.2.1 Spark Distribution Reward (Core, instance defining doc)
//      │   └─ A.2.1.1 Reward Rate (Core)
//      └─ A.2.2 Spark Active Data (Active Data)
// Entities: spark (agent/prime → A.2), spark-distribution-reward (instance → A.2.1),
//           op-facilitator (facilitator_org). Edges wire the graph tools.
const D = {
  SCO: "sco", ART: "art", SEC: "sec", COR: "cor", SPK: "spk", INS: "ins", PRM: "prm", ADT: "adt",
};
function node(id: string, doc_no: string, type: string, depth: number, parentId: string | null, content: string): AtlasNode {
  return { id, doc_no, title: doc_no, type, depth, parentId, order: 0, content, contentHash: `h-${id}`, addressRefs: [] } as AtlasNode;
}
function edge(id: number, from_id: string, from_type: string, to_id: string, to_type: string, edge_type: string): Edge {
  return { id, from_id, from_type, to_id, to_type, edge_type, source_doc_nos: null, weight: 1, meta: null };
}
function entity(id: string, slug: string, name: string, entity_type: string, subtype: string | null, defining_doc_id: string | null): Entity {
  return { id, slug, name, entity_type, subtype, defining_doc_id, is_active: 1, meta: null };
}

function makeAtlas() {
  const docs = [
    node(D.SCO, "A", "Scope", 1, null, "governance scope root"),
    node(D.ART, "A.1", "Article", 2, D.SCO, "aligned delegates article"),
    node(D.SEC, "A.1.1", "Section", 3, D.ART, "delegate responsibilities zebraword"),
    node(D.COR, "A.1.1.1", "Core", 4, D.SEC, "aligned delegate voting zebraword rules"),
    node(D.SPK, "A.2", "Article", 2, D.SCO, "spark prime agent article"),
    node(D.INS, "A.2.1", "Core", 3, D.SPK, "spark distribution reward instance"),
    node(D.PRM, "A.2.1.1", "Core", 4, D.INS, "the reward rate is 5 percent"),
    node(D.ADT, "A.2.2", "Active Data", 3, D.SPK, "spark active data list"),
  ];
  const edges: Edge[] = [
    edge(1, D.SCO, "doc", D.ART, "doc", "parent_of"),
    edge(2, D.ART, "doc", D.SEC, "doc", "parent_of"),
    edge(3, D.SEC, "doc", D.COR, "doc", "parent_of"),
    edge(4, D.SCO, "doc", D.SPK, "doc", "parent_of"),
    edge(5, D.SPK, "doc", D.INS, "doc", "parent_of"),
    edge(6, D.INS, "doc", D.PRM, "doc", "parent_of"),
    edge(7, D.SPK, "doc", D.ADT, "doc", "parent_of"),
    edge(8, D.COR, "doc", D.ADT, "doc", "cites"),
    edge(9, "e-spark", "entity", D.SEC, "doc", "responsible_party_for"),
    edge(10, "e-spark", "entity", D.ADT, "doc", "active_data_for"),
    edge(11, "e-fac", "entity", "e-spark", "entity", "operational_facilitator_for"),
  ];
  const entities: Entity[] = [
    entity("e-spark", "spark", "Spark", "agent", "prime", D.SPK),
    entity("e-spk-rw", "spark-distribution-reward", "Spark Distribution Reward", "instance", "distribution-reward", D.INS),
    entity("e-fac", "op-facilitator", "Operational Facilitator", "facilitator_org", null, null),
  ];
  return buildIndexes(docs, entities, edges, { atlasCommit: "test" });
}

const call = (name: string, args: Record<string, unknown>) => TOOLS_BY_NAME.get(name)!.handler(makeAtlas(), args);

// ── Registry integrity (all 25 tools) ───────────────────────────────────────
test("external_msc is MCP-only, description leads with Rule 1, and is not in ATLAS_TOOLS", () => {
  expect(EXTERNAL_TOOLS.length).toBeGreaterThan(0);
  for (const t of EXTERNAL_TOOLS) {
    expect(t.name).not.toMatch(/^atlas_/);
    expect(t.description.startsWith("NOT Atlas")).toBe(true);
    expect(TOOLS_BY_NAME.has(t.name)).toBe(false);
  }
  expect(EXTERNAL_TOOLS.some((t) => t.name === "external_msc")).toBe(true);
  expect(EXTERNAL_TOOLS.find((t) => t.name === "external_msc")!.description).toMatch(/\baggregate\b/);
});

test("tool registry is well-formed: 25 unique tools, valid shapes + handlers", () => {
  expect(ATLAS_TOOLS.length).toBe(25);
  const names = ATLAS_TOOLS.map((t) => t.name);
  expect(new Set(names).size).toBe(names.length); // unique
  expect(TOOLS_BY_NAME.size).toBe(25);
  for (const t of ATLAS_TOOLS) {
    expect(t.name).toMatch(/^atlas_/);
    expect(typeof t.description).toBe("string");
    expect(t.description.length).toBeGreaterThan(20);
    expect(typeof t.handler).toBe("function");
    expect(t.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(typeof t.annotations?.title).toBe("string");
    // shape must be a valid ZodRawShape (z.object accepts it without throwing).
    expect(() => z.object(t.shape)).not.toThrow();
  }
});

// ── describe / get / neighbors ───────────────────────────────────────────────
test("atlas_describe: default vocab; sections opt-in", () => {
  const def = call("atlas_describe", {}) as Record<string, unknown>;
  expect((def.doc_types as unknown[]).length).toBeGreaterThan(0);
  expect("entity_type_graph" in def).toBe(false);
  const graph = call("atlas_describe", { sections: ["entity_type_graph"] }) as Record<string, unknown>;
  expect(graph.entity_type_graph).toBeDefined();
});

test("atlas_get: single, bulk, and not-found", () => {
  const one = call("atlas_get", { id: "A.1.1.1" }) as Record<string, unknown>;
  expect(one.title).toBe("A.1.1.1");
  expect((one.ancestors as Array<{ doc_no: string }>).map((a) => a.doc_no)).toEqual(["A.1.1", "A.1", "A"]);
  const bulk = call("atlas_get", { id: ["A.1", "nope"] }) as { results: Array<Record<string, unknown>> };
  expect(bulk.results.length).toBe(2);
  expect(bulk.results[1].error).toBeDefined();
});

test("atlas_neighbors: parent, siblings, children", () => {
  const n = call("atlas_neighbors", { id: "A.1.1", window: 8 }) as Record<string, any>;
  expect(n.parent.doc_no).toBe("A.1");
  expect(n.children.map((c: any) => c.doc_no)).toEqual(["A.1.1.1"]);
});

// ── traverse: edge-type filter, direction, hops+edge_type in output ──────────
test("atlas_traverse: edge_type filter + hops/edge_type/direction on results", () => {
  const cites = call("atlas_traverse", { id: "A.1.1.1", edge_type: "cites", hops: 1, direction: "out" }) as { results: any[] };
  expect(cites.results.map((r) => r.doc_no)).toEqual(["A.2.2"]);
  expect(cites.results[0]).toMatchObject({ hops: 1, edge_type: "cites", direction: "out" });

  const up = call("atlas_traverse", { id: "A.1.1.1", edge_type: "parent_of", hops: 1, direction: "in" }) as { results: any[] };
  expect(up.results[0]).toMatchObject({ doc_no: "A.1.1", direction: "in" });
});

test("atlas_traverse: multi-hop results include the full path; 1-hop don't", () => {
  const r = call("atlas_traverse", { id: "A", edge_type: "parent_of", hops: 2, direction: "out" }) as { results: any[] };
  const oneHop = r.results.find((x) => x.doc_no === "A.1");
  expect(oneHop.path).toBeUndefined(); // single hop needs no path
  const twoHop = r.results.find((x) => x.doc_no === "A.1.1");
  expect(twoHop.hops).toBe(2);
  expect(twoHop.path.map((s: any) => s.doc_no)).toEqual(["A.1", "A.1.1"]); // A → A.1 → A.1.1
  expect(twoHop.path.every((s: any) => s.edge_type === "parent_of" && s.direction === "out")).toBe(true);
});

test("atlas_edges: registry wiring filters globally with resolved endpoints", () => {
  const r = call("atlas_edges", {
    edge_type: "operational_facilitator_for",
    from_slug: "op-facilitator",
    include_docs: false,
    limit: 50,
    offset: 0,
  }) as { total: number; edges: any[] };

  expect(r.total).toBe(1);
  expect(r.edges[0].from).toMatchObject({ node_type: "entity", slug: "op-facilitator", type: "facilitator_org" });
  expect(r.edges[0].to).toMatchObject({ node_type: "entity", slug: "spark", type: "agent", subtype: "prime" });
});

// ── entity + entities + entity_params ────────────────────────────────────────
test("atlas_entity: resolves NL name, paginates, filters by type", () => {
  const r = call("atlas_entity", { name: "Spark Protocol", limit: 50, offset: 0, include_content: false }) as Record<string, any>;
  expect(r.resolved.slug).toBe("spark");
  expect(r.node_count).toBeGreaterThan(0);
  expect(r.node_types).toBeDefined();
  // responsible_party_for edge → SEC shows up as a responsibility.
  expect(r.responsibilities.map((x: any) => x.doc_no)).toContain("A.1.1");
});

test("atlas_entities: fuzzy search + type filter", () => {
  const byName = call("atlas_entities", { q: "spark", limit: 50, offset: 0 }) as { results: any[] };
  expect(byName.results[0].slug).toBe("spark"); // exact wins over spark-distribution-reward
  const insts = call("atlas_entities", { entity_type: "instance", limit: 50, offset: 0 }) as { total: number };
  expect(insts.total).toBe(1);
});

test("atlas_entity_params: id path + entity path with subtype filter", () => {
  const byId = call("atlas_entity_params", { id: "A.2.1", limit: 50 }) as { instances: any[] };
  expect(byId.instances[0].params.map((p: any) => p.doc_no)).toContain("A.2.1.1");
  const byEntity = call("atlas_entity_params", { entity: "spark", type_hint: "reward", limit: 50 }) as { instances: any[]; available_subtypes: string[] };
  expect(byEntity.instances.map((i: any) => i.doc_no)).toEqual(["A.2.1"]);
  expect(byEntity.available_subtypes).toContain("distribution-reward");
});

// ── atlas_params (wired via TOOLS_BY_NAME; extraction itself is tools-params.test.ts's job) ──
test("atlas_params: wired end-to-end, errors on an unusable query, returns a well-formed result otherwise", () => {
  const empty = call("atlas_params", { q: "at" }) as { error?: string };
  expect(empty.error).toBeDefined();
  const res = call("atlas_params", { q: "reward rate" }) as { count: number; rows: unknown[] };
  expect(res.count).toBe(res.rows.length);
});

// ── filter ───────────────────────────────────────────────────────────────────
test("atlas_filter: type, doc_no_pattern, ancestor scope, depth", () => {
  const cores = call("atlas_filter", { type: "Core", limit: 200, include_content: false }) as { results: any[] };
  expect(cores.results.every((r) => r.type === "Core")).toBe(true);
  const pat = call("atlas_filter", { doc_no_pattern: "A.2.%", limit: 200, include_content: false }) as { results: any[] };
  expect(pat.results.map((r) => r.doc_no).sort()).toEqual(["A.2.1", "A.2.1.1", "A.2.2"]);
  const scoped = call("atlas_filter", { ancestor_id: "A.1", type: "Core", limit: 200, include_content: false }) as { results: any[] };
  expect(scoped.results.map((r) => r.doc_no)).toEqual(["A.1.1.1"]);
  const err = call("atlas_filter", { limit: 200, include_content: false }) as { error?: string };
  expect(err.error).toBeDefined(); // no filter provided
});

// ── search (lexical + hybrid + phrase filter) ────────────────────────────────
test("atlas_search: lexical results carry sources + snippet; phrase post-filter", async () => {
  const lex = (await call("atlas_search", { query: "zebraword", k: 10, mode: "lexical" })) as { results: any[] };
  expect(lex.results.length).toBeGreaterThanOrEqual(2); // SEC + COR
  expect(lex.results[0].sources).toContain("lexical");
  expect(typeof lex.results[0].snippet).toBe("string");

  // Lexical type filter is a docMap post-filter (index stores no fields).
  const typed = (await call("atlas_search", { query: "zebraword", type: "Core", k: 10, mode: "lexical" })) as { results: any[] };
  expect(typed.results.map((r) => r.doc_no)).toEqual(["A.1.1.1"]); // Section A.1.1 filtered out

  // Quoted phrase requires an exact substring — only the Core has "voting zebraword".
  const phrase = (await call("atlas_search", { query: '"voting zebraword"', k: 10, mode: "hybrid" })) as { results: any[]; phrase_filter: string[] };
  expect(phrase.phrase_filter).toContain("voting zebraword");
  expect(phrase.results.map((r) => r.doc_no)).toEqual(["A.1.1.1"]);
});

// ── query: search / target_type / ancestor / entity_broad / type_list / chain ─
test("atlas_query: search is lean by default and intersects target_type", async () => {
  const s = (await call("atlas_query", { q: "zebraword", k: 10, enrich: false })) as Record<string, any>;
  expect(s.mode).toBe("search");
  expect(s.results[0].content).toBeUndefined(); // lean rows
  expect(s.results[0].snippet).toBeDefined();
  expect(s.results.map((r: any) => r.doc_no).sort()).toEqual(["A.1.1", "A.1.1.1"]);

  // target_type flows into the lexical leg's docMap post-filter → Section drops out.
  const typed = (await call("atlas_query", { q: "zebraword", target_type: "Core", k: 10, enrich: false })) as { results: any[] };
  expect(typed.results.map((r) => r.doc_no)).toEqual(["A.1.1.1"]);
});

test("atlas_query: ancestor scope narrows results", async () => {
  const under2 = (await call("atlas_query", { q: "zebraword", ancestor_id: "A.2", k: 10, enrich: false })) as { results: any[] };
  expect(under2.results.length).toBe(0); // zebraword only under A.1
});

test("atlas_query: entity_broad groups by relationship; type_list lists a type", async () => {
  const broad = (await call("atlas_query", { entity: "spark", k: 10, enrich: false })) as Record<string, any>;
  expect(broad.mode).toBe("entity_broad");
  expect(broad.by_relationship.responsible_party_for.map((d: any) => d.doc_no)).toContain("A.1.1");

  const list = (await call("atlas_query", { target_type: "Active Data", k: 10, enrich: false })) as { mode: string; results: any[] };
  expect(list.mode).toBe("type_list");
  expect(list.results.map((r) => r.doc_no)).toEqual(["A.2.2"]);
});

test("atlas_query: entity_chain hops entity→entity→docs", async () => {
  const chain = (await call("atlas_query", { entity: "op-facilitator", via_entity_type: "agent", k: 10, enrich: false })) as Record<string, any>;
  expect(chain.mode).toBe("entity_chain");
  // op-facilitator --operational_facilitator_for--> spark (agent) → spark's docs.
  expect(chain.results.map((r: any) => r.doc_no)).toContain("A.1.1");
});
