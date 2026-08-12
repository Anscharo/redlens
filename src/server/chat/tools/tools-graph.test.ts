// Pure tool-layer unit tests for the graph tools. Run under `bun test` (NOT
// vitest) — src/server is excluded from vitest. These functions are fully
// in-memory (no SQL), so a hand-built Indexes fixture is enough.
import { test, expect } from "bun:test";
import { atlasTraverse, atlasEntity, atlasEntities, atlasEdges, atlasEntityParams, atlasNeighbors, atlasFilter } from "./tools-graph.ts";
import { atlasGet, atlasDescribe } from "./tools.ts";
import { buildSystemPrompt, validReportTool } from "../system-prompt.ts";
import { matchEntities } from "../../retrieval/entity-resolve.ts";
import { fitToBudget } from "../output-budget.ts";
import type { Indexes, AtlasNode, Edge, Entity } from "../../retrieval/indexes.ts";

// ── Fixture ──────────────────────────────────────────────────────────────
// Subtree under D0:  D0 ─┬─ D1 (instance: distribution-reward) ─┬─ P1
//                        │                                       └─ P2
//                        └─ D2 (instance: allocation-system, Active Data) ─ P3
// Plus a cites edge D1 → DX (out of subtree), and E ─defines_entity→ D0.
function node(id: string, doc_no: string, type: string, depth: number, parentId: string | null): AtlasNode {
  return { id, doc_no, title: id, type, depth, parentId, order: 0, content: `content ${id}`, contentHash: `hash-${id}`, addressRefs: [] } as AtlasNode;
}
function edge(id: number, from_id: string, to_id: string, edge_type: string): Edge {
  return { id, from_id, from_type: "doc", to_id, to_type: "doc", edge_type, source_doc_nos: null, weight: 1, meta: null };
}
function entity(id: string, slug: string, entity_type: string, subtype: string | null, defining_doc_id: string): Entity {
  return { id, slug, name: slug, entity_type, subtype, defining_doc_id, is_active: 1, meta: null };
}
const ADDR_SELF = "0x1111111111111111111111111111111111111111";
const ADDR_OUT = "0x2222222222222222222222222222222222222222";
const ADDR_IN = "So11111111111111111111111111111111111111112"; // base58 — no colon of its own

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
    {
      ...edge(8, "E", "IE1", "integration_partner_of"),
      from_type: "entity",
      to_type: "entity",
      source_doc_nos: JSON.stringify(["A.1.1"]),
      meta: JSON.stringify({ role: "partner" }),
    },
    // On-chain addresses hang off the entity that HOLDS them. Three shapes:
    // the queried entity's own, one held by an entity it points AT, and one
    // held by an entity that points at IT (instances link inbound via
    // invoked_by — an outbound-only walk would miss every instance address).
    { ...edge(9, "E", `${ADDR_SELF}:ethereum`, "has_address"), from_type: "entity", to_type: "address" },
    {
      ...edge(10, "IE1", `${ADDR_OUT}:ethereum`, "has_address"),
      from_type: "entity",
      to_type: "address",
      source_doc_nos: JSON.stringify(["A.1.1"]),
    },
    { ...edge(11, "IE2", "E", "invoked_by"), from_type: "entity", to_type: "entity" },
    { ...edge(12, "IE2", `${ADDR_IN}:solana`, "has_address"), from_type: "entity", to_type: "address" },
  ];
  const entities: Entity[] = [
    entity("E", "ent", "agent", "prime", "D0"),
    entity("IE1", "ent-distribution-reward", "instance", "distribution-reward", "D1"),
    entity("IE2", "ent-allocation-system", "instance", "allocation-system", "D2"),
    entity("IE3", "ent-orphan", "ecosystem_actor", null, "P3"),
  ];
  return {
    docMap,
    byDocNo,
    childrenIndex,
    edges,
    entities,
    entityBySlug: new Map(entities.map((e) => [e.slug, e])),
    entityById: new Map(entities.map((e) => [e.id, e])),
    // atlas_describe's shape section reads these.
    glossary: new Map(),
    // Every doc settled (no scaffold/placeholder tags) — the liveness-tagging
    // paths (docRow decoration in atlasNeighbors/atlasFilter/atlasEntity) still
    // read this map even when it's empty.
    liveness: new Map(),
    meta: {},
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

// ── atlas_entity: the addresses block (both edge directions) ─────────────────
test("atlas_entity returns addresses it holds AND those held by entities linked either way", () => {
  const ix = makeIx();
  const res = atlasEntity(ix, "ent", { limit: 50, offset: 0, include_content: false }) as {
    addresses: { count: number; groups: Array<Record<string, unknown>>; truncated?: true };
  };
  expect(res.addresses.count).toBe(3);
  expect(res.addresses.truncated).toBeUndefined();
  const by = new Map(res.addresses.groups.map((g) => [g.owner as string, g]));

  expect(by.get("ent")).toMatchObject({ via: "self", direction: "self", addresses: [{ address: ADDR_SELF, chain: "ethereum" }] });
  // Outbound hop (entity → instance), with the has_address edge's provenance.
  expect(by.get("ent-distribution-reward")).toMatchObject({
    via: "integration_partner_of",
    direction: "out",
    addresses: [{ address: ADDR_OUT, chain: "ethereum" }],
    source_doc_nos: ["A.1.1"],
  });
  // Inbound hop (instance → entity via invoked_by) — the direction an
  // outbound-only walk drops. Base58 keeps its case and carries no colon.
  expect(by.get("ent-allocation-system")).toMatchObject({
    via: "invoked_by",
    direction: "in",
    addresses: [{ address: ADDR_IN, chain: "solana" }],
  });
});

test("atlas_entity reports an empty addresses block rather than omitting it", () => {
  const ix = makeIx();
  const res = atlasEntity(ix, "ent-orphan", { limit: 50, offset: 0, include_content: false }) as {
    addresses: { count: number; groups: unknown[] };
  };
  expect(res.addresses).toEqual({ count: 0, groups: [] });
});

// ── atlas_traverse: entity-slug start + address nodes ────────────────────────
test("atlas_traverse starts from an entity slug and returns address nodes", () => {
  const ix = makeIx();
  const res = atlasTraverse(ix, "ent", "has_address", 1, "out") as { count: number; results: Array<Record<string, unknown>> };
  expect(res.count).toBe(1);
  expect(res.results[0]).toMatchObject({
    id: `${ADDR_SELF}:ethereum`,
    node_type: "address",
    address: ADDR_SELF,
    chain: "ethereum",
    hops: 1,
    edge_type: "has_address",
  });
  // An instance's address is two hops out and changes direction on the way
  // (instance→entity inbound, then instance→address outbound), so it is
  // reachable only with direction "both" and no edge_type filter.
  const two = atlasTraverse(ix, "ent", undefined, 2, "both") as { results: Array<{ id: string; hops: number }> };
  expect(two.results.some((r) => r.id === `${ADDR_IN}:solana` && r.hops === 2)).toBe(true);
  // A name that resolves to no doc and no entity is still an error.
  expect((atlasTraverse(ix, "nonexistent", undefined, 1, "out") as { error?: string }).error).toBe("Not found");
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

// ── liveness tagging (docs/research/synlang-wiki.md §3.2) ────────────────────
// makeIx() builds `liveness` as an empty Map (no census machinery run over
// this hand-built fixture) — populate it directly per test to exercise the
// tagging plumbing without re-deriving conceptsCensus heuristics here.
test("atlas_neighbors tags parent/sibling/child rows with liveness and adds the envelope hint", () => {
  const ix = makeIx();
  ix.liveness.set("D2", "placeholder"); // sibling of D1
  ix.liveness.set("P1", "scaffold"); // child of D1
  const res = atlasNeighbors(ix, "D1", 8) as {
    parent: Record<string, unknown>;
    siblings: Array<Record<string, unknown>>;
    children: Array<Record<string, unknown>>;
    liveness_hint?: string;
  };
  expect(res.siblings.find((s) => s.id === "D2")!.liveness).toBe("placeholder");
  expect(res.children.find((c) => c.id === "P1")!.liveness).toBe("scaffold");
  expect(res.parent.liveness).toBeUndefined(); // D0 untagged
  expect(res.liveness_hint).toContain("liveness:scaffold");
});

test("atlas_neighbors tags the target itself — the one node the call is about", () => {
  const ix = makeIx();
  ix.liveness.set("D1", "scaffold");
  const res = atlasNeighbors(ix, "D1", 8) as { target: Record<string, unknown>; liveness_hint?: string };
  expect(res.target.liveness).toBe("scaffold");
  // A scaffold target alone must raise the envelope hint, even when every
  // neighbour row is settled.
  expect(res.liveness_hint).toContain("liveness:scaffold");
});

test("atlas_filter tags result rows with liveness and adds the envelope hint only when a row is flagged", () => {
  const ix = makeIx();
  ix.liveness.set("P1", "scaffold");
  const flagged = atlasFilter(ix, { type: "Core", limit: 200, include_content: false }) as {
    results: Array<Record<string, unknown>>;
    liveness_hint?: string;
  };
  expect(flagged.results.find((r) => r.id === "P1")!.liveness).toBe("scaffold");
  expect(flagged.liveness_hint).toBeDefined();

  const clean = atlasFilter(ix, { type: "Active Data", limit: 200, include_content: false }) as { liveness_hint?: string };
  expect(clean.liveness_hint).toBeUndefined();
});

test("atlas_entity tags `nodes` rows with liveness and adds the envelope hint", () => {
  const ix = makeIx();
  ix.liveness.set("P3", "placeholder");
  const res = atlasEntity(ix, "ent", { limit: 50, offset: 0, include_content: false }) as {
    nodes: Array<Record<string, unknown>>;
    liveness_hint?: string;
  };
  expect(res.nodes.find((n) => n.id === "P3")!.liveness).toBe("placeholder");
  expect(res.liveness_hint).toBeDefined();
});

// ── entity resolution: free text → entity ────────────────────────────────────
test("matchEntities resolves exact slug and disambiguates multi-token names", () => {
  const ix = makeIx();
  // Bare "ent" → the prime entity (exact slug wins big).
  expect(matchEntities(ix, "ent")[0].entity.slug).toBe("ent");
  // Extra query words are ignored, so a plain name still resolves.
  expect(matchEntities(ix, "ent protocol")[0].entity.slug).toBe("ent");
  // A more specific multi-token name beats the shorter prime entity.
  expect(matchEntities(ix, "ent distribution reward")[0].entity.slug).toBe("ent-distribution-reward");
  // No token overlap → no match.
  expect(matchEntities(ix, "nonexistent")).toEqual([]);
});

test("atlas_entity accepts a natural-language name and echoes what it resolved", () => {
  const ix = makeIx();
  const res = atlasEntity(ix, "ent protocol", { limit: 50, offset: 0, include_content: false }) as Record<string, unknown>;
  expect((res.resolved as { slug: string }).slug).toBe("ent");
  expect(res.node_count).toBe(6);
});

// ── atlas_entities: discovery / filtering ────────────────────────────────────
test("atlas_entities searches by name and filters by type", () => {
  const ix = makeIx();
  const byName = atlasEntities(ix, { q: "ent distribution reward", limit: 50, offset: 0 }) as { results: Array<{ slug: string }> };
  expect(byName.results[0].slug).toBe("ent-distribution-reward");

  const instances = atlasEntities(ix, { entity_type: "instance", limit: 50, offset: 0 }) as { total: number; results: Array<{ slug: string }> };
  expect(instances.total).toBe(2);
  expect(instances.results.map((r) => r.slug).sort()).toEqual(["ent-allocation-system", "ent-distribution-reward"]);
});

// ── atlas_edges: global edge enumeration ────────────────────────────────────
test("atlas_edges filters, resolves endpoints, paginates, and includes provenance", () => {
  const ix = makeIx();
  const byType = atlasEdges(ix, {
    edge_type: "integration_partner_of",
    from_slug: "ent",
    include_docs: true,
    limit: 50,
    offset: 0,
  }) as Record<string, any>;

  expect(byType.total).toBe(1);
  expect(byType.count).toBe(1);
  expect(byType.edges[0].from).toMatchObject({ node_type: "entity", slug: "ent", type: "agent", name: "ent" });
  expect(byType.edges[0].to).toMatchObject({
    node_type: "entity",
    slug: "ent-distribution-reward",
    type: "instance",
    subtype: "distribution-reward",
  });
  expect(byType.edges[0].meta).toEqual({ role: "partner" });
  expect(byType.edges[0].source_doc_nos).toEqual(["A.1.1"]);
  expect(byType.edges[0].provenance).toEqual([{ node_id: "D1", doc_no: "A.1.1", title: "D1", type: "Core" }]);

  const page = atlasEdges(ix, {
    from_type: "doc",
    to_type: "doc",
    include_docs: false,
    limit: 2,
    offset: 1,
  }) as Record<string, any>;
  expect(page.total).toBe(6);
  expect(page.count).toBe(2);
  expect(page.has_more).toBe(true);
  expect(page.next_offset).toBe(3);
  expect(page.edges[0].provenance).toBeUndefined();

  const missing = atlasEdges(ix, { from_slug: "nope", include_docs: false, limit: 10, offset: 0 }) as { error?: string };
  expect(missing.error).toContain("from_slug");
});

// ── atlas_get: lean payload ──────────────────────────────────────────────────
test("atlas_get drops contentHash but keeps content + ancestors", () => {
  const ix = makeIx();
  const one = atlasGet(ix, "D1") as Record<string, unknown>;
  expect(one.contentHash).toBeUndefined();
  expect(one.content).toBe("content D1");
  expect((one.ancestors as Array<{ id: string }>).map((a) => a.id)).toEqual(["D0"]);
});

// ── atlas_describe: heavy sections opt-in ────────────────────────────────────
test("atlas_describe keeps entity_type_graph + type_specifications opt-in", () => {
  const ix = makeIx();
  const def = atlasDescribe(ix) as Record<string, unknown>;
  expect(def.doc_types).toBeDefined(); // light vocab always present
  expect("entity_type_graph" in def).toBe(false);
  expect("type_specifications" in def).toBe(false);
  // entity_types keys are `${type} ${subtype}` split on a real space. A NUL byte
  // (or any non-space) between them would cram the whole key into entity_type.
  const inst = (def.entity_types as Array<{ entity_type: string; subtype: string | null }>).find(
    (e) => e.entity_type === "instance",
  );
  expect(inst).toBeDefined();
  expect(["distribution-reward", "allocation-system"]).toContain(inst!.subtype ?? "");

  const all = atlasDescribe(ix, ["all"]) as Record<string, unknown>;
  expect("entity_type_graph" in all).toBe(true);
  expect("type_specifications" in all).toBe(true);

  const one = atlasDescribe(ix, ["type_specifications"]) as Record<string, unknown>;
  expect("type_specifications" in one).toBe(true);
  expect("entity_type_graph" in one).toBe(false);
  expect(one.doc_types).toBeDefined(); // light sections stay even when sections is set
});

// ── system prompt: describe section dependency ───────────────────────────────
test("buildSystemPrompt does not throw (entity_type_graph must be requested)", () => {
  const ix = makeIx();
  expect(() => buildSystemPrompt(ix)).not.toThrow();
  expect(buildSystemPrompt(ix)).toContain("Sky Atlas by Redline");
});

// ── report-page tool steering ────────────────────────────────────────────────
test("validReportTool accepts only registered atlas_report_* tools", () => {
  expect(validReportTool({ reportTool: "atlas_report_rewards" })).toBe("atlas_report_rewards");
  expect(validReportTool({ reportTool: "atlas_report_bogus" })).toBeNull(); // report-shaped but not registered
  expect(validReportTool({ reportTool: "atlas_query" })).toBeNull(); // real tool, wrong family
  expect(validReportTool({ reportTool: "rm -rf" })).toBeNull(); // arbitrary string
  expect(validReportTool({})).toBeNull();
  expect(validReportTool(undefined)).toBeNull();
});

test("buildSystemPrompt steers to a report page's backing tool", () => {
  const ix = makeIx();
  const prompt = buildSystemPrompt(ix, { path: "/reports/rewards", reportName: "Integrator Reward Relationships", reportTool: "atlas_report_rewards" });
  expect(prompt).toContain("Integrator Reward Relationships");
  expect(prompt).toContain("`atlas_report_rewards`");
  expect(prompt).toContain("this report");
});

test("buildSystemPrompt ignores a spoofed/unknown report tool", () => {
  const ix = makeIx();
  const prompt = buildSystemPrompt(ix, { path: "/reports/x", reportName: "Fake", reportTool: "atlas_report_bogus" });
  expect(prompt).not.toContain("atlas_report_bogus");
  expect(prompt).toContain("Current page"); // page context still present, just no tool steer
});

test("buildSystemPrompt surfaces the active report filter as the tool's filter arg", () => {
  const ix = makeIx();
  const prompt = buildSystemPrompt(ix, {
    path: "/reports/rewards",
    reportName: "Integrator Reward Relationships",
    reportTool: "atlas_report_rewards",
    reportFilter: "spark",
  });
  expect(prompt).toContain('filter: "spark"');
  // Sanitized: backticks/newlines stripped, length-capped, and only with a valid tool.
  const dirty = buildSystemPrompt(ix, { reportName: "R", reportTool: "atlas_report_rewards", reportFilter: "a`b\nc" });
  expect(dirty).toContain('filter: "a b c"');
  const noTool = buildSystemPrompt(ix, { path: "/reports/x", reportName: "R", reportFilter: "spark" });
  expect(noTool).not.toContain('filter: "spark"'); // no backing tool → no filter steer
});

// ── output budget ────────────────────────────────────────────────────────────
test("fitToBudget keeps items under budget and flags truncation", () => {
  const items = ["aaaa", "bbbb", "cccc"]; // each ~7 chars serialized
  const tight = fitToBudget(items, 12);
  expect(tight.kept).toEqual(["aaaa"]);
  expect(tight.truncated).toBe(true);

  const loose = fitToBudget(items, 9999);
  expect(loose.kept.length).toBe(3);
  expect(loose.truncated).toBe(false);

  // Always keeps at least one item, even if it alone exceeds the budget.
  expect(fitToBudget(["huge"], 1).kept.length).toBe(1);
});
