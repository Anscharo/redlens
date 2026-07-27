// End-to-end registry tests. Run under `bun test` (NOT vitest). Every tool in
// ATLAS_TOOLS is invoked through the same execToolDetailed() path the chat loop
// uses (zod-parses args against the tool's own shape, applying its defaults,
// then calls the handler) — this exercises every handler lambda in
// tool-registry.ts plus the pure/DB-backed tool implementations it wires up.
//
// DB-backed tools (atlas_get_address, atlas_history*, atlas_pr,
// atlas_changed_between, atlas_first_seen) need "../../db.ts" mocked — bun's
// mock.module patches the module in place, so it applies even though tool-
// registry.ts (and its transitive imports) are already loaded elsewhere in this
// test run. A plain empty-rows stub is enough: every handler already degrades
// gracefully to an empty/"not found" result with no rows (proven by
// tools-history.test.ts's pure summarizeHistoryStats tests), so this is about
// exercising the handler wiring, not re-testing DB query logic.
import { test, expect, mock, beforeEach } from "bun:test";
import { ATLAS_TOOLS, TOOLS_BY_NAME, toolDescription, type AtlasTool } from "./tool-registry.ts";
import { execToolDetailed } from "./llm-tools.ts";
import { buildIndexes, type AtlasNode, type Entity, type Edge, type Indexes } from "../../retrieval/indexes.ts";

function mockDb(rows: unknown[] = []) {
  const fn = Object.assign(
    (..._args: unknown[]) => Promise.resolve(rows),
    { unsafe: (..._args: unknown[]) => Promise.resolve(rows) },
  );
  mock.module("../../db.ts", () => ({
    sql: fn,
    toVectorLiteral: (v: number[]) => `[${v.join(",")}]`,
    dbTarget: () => "mock:5432/db",
    waitForDb: async () => {},
  }));
}

function doc(id: string, doc_no: string, type: string, depth: number, parentId: string | null, content = `content ${id}`): AtlasNode {
  return { id, doc_no, title: id, type, depth, parentId, order: 0, content, addressRefs: [] } as AtlasNode;
}
function edge(id: number, from_id: string, to_id: string, edge_type: string, overrides: Partial<Edge> = {}): Edge {
  return { id, from_id, from_type: "doc", to_id, to_type: "doc", edge_type, source_doc_nos: null, weight: 1, meta: null, ...overrides };
}
function entity(id: string, slug: string, entity_type: string, subtype: string | null, defining_doc_id: string): Entity {
  return { id, slug, name: slug, entity_type, subtype, defining_doc_id, is_active: 1, meta: null };
}

function makeIx(): Indexes {
  const docs = [
    doc("D0", "A.1", "Core", 1, null, "Sky governance root document about the USDS token and facilitator duties."),
    doc("D1", "A.1.1", "Core", 2, "D0", "Distribution reward instance detail."),
    doc("D2", "A.1.2", "Active Data", 2, "D0", "Allocation system active data controller."),
    doc("P1", "A.1.1.1", "Core", 3, "D1"),
    doc("P2", "A.1.1.2", "Core", 3, "D1"),
    doc("P3", "A.1.2.1", "Core", 3, "D2"),
    doc("DX", "A.9", "Core", 1, null, "cites target"),
    doc("TS", "A.0.1", "Type Specification", 1, null, "type spec doc"),
  ];
  const edges: Edge[] = [
    edge(1, "D0", "D1", "parent_of"),
    edge(2, "D0", "D2", "parent_of"),
    edge(3, "D1", "P1", "parent_of"),
    edge(4, "D1", "P2", "parent_of"),
    edge(5, "D2", "P3", "parent_of"),
    edge(6, "D1", "DX", "cites"),
    edge(7, "E", "D0", "defines_entity", { from_type: "entity" }),
    edge(8, "E", "IE1", "integration_partner_of", {
      from_type: "entity",
      to_type: "entity",
      source_doc_nos: JSON.stringify(["A.1.1"]),
      meta: JSON.stringify({ role: "partner" }),
    }),
  ];
  const entities: Entity[] = [
    entity("E", "ent", "agent", "prime", "D0"),
    entity("IE1", "ent-distribution-reward", "instance", "distribution-reward", "D1"),
    entity("IE2", "ent-allocation-system", "instance", "allocation-system", "D2"),
  ];
  return buildIndexes(docs, entities, edges, {});
}

beforeEach(() => {
  mock.restore();
  mockDb([]);
});

// ── toolDescription ──────────────────────────────────────────────────────────
test("toolDescription appends whenToUse when present, and omits it when absent", () => {
  const withSteer = ATLAS_TOOLS.find((t) => t.whenToUse)!;
  expect(withSteer).toBeDefined();
  const combined = toolDescription(withSteer);
  expect(combined).toContain(withSteer.description);
  expect(combined).toContain("When to use:");
  expect(combined).toContain(withSteer.whenToUse!);

  const noSteer: AtlasTool = { ...withSteer, whenToUse: undefined };
  expect(toolDescription(noSteer)).toBe(noSteer.description);
  expect(toolDescription(noSteer)).not.toContain("When to use:");
});

// ── registry shape ────────────────────────────────────────────────────────────
test("TOOLS_BY_NAME indexes every ATLAS_TOOLS entry by its own unique name", () => {
  expect(TOOLS_BY_NAME.size).toBe(ATLAS_TOOLS.length);
  for (const t of ATLAS_TOOLS) expect(TOOLS_BY_NAME.get(t.name)).toBe(t);
});

test("every tool is read-only/non-destructive/idempotent and closed-world", () => {
  for (const t of ATLAS_TOOLS) {
    expect(t.annotations?.readOnlyHint).toBe(true);
    expect(t.annotations?.destructiveHint).toBe(false);
    expect(t.annotations?.idempotentHint).toBe(true);
    expect(t.annotations?.openWorldHint).toBe(false);
    expect(t.annotations?.title).toBeTruthy();
  }
});

// ── every handler wired end-to-end ────────────────────────────────────────────
const ARGS: Record<string, Record<string, unknown>> = {
  atlas_describe: { sections: ["all"] },
  atlas_get: { id: "D1" },
  atlas_search: { query: "governance" },
  atlas_get_address: { address: "0x0000000000000000000000000000000000dEaD" },
  atlas_neighbors: { id: "D1" },
  atlas_traverse: { id: "D1", direction: "both" },
  atlas_entities: { q: "ent" },
  atlas_edges: {},
  atlas_entity: { name: "ent" },
  atlas_filter: { type: "Core" },
  atlas_entity_params: { id: "D1" },
  atlas_history: { id: "D1", with_diff: true },
  atlas_recent_changes: {},
  atlas_history_stats: { include_top_docs: true, include_prs: true, group_by: ["doc_type"] },
  atlas_pr: { pr_number: 1 },
  atlas_changed_between: { commit_a: "abc1234", commit_b: "def5678" },
  atlas_first_seen: { ids: ["D1", "ent"] },
  atlas_query: { q: "governance" },
  atlas_report_multisigs: {},
  atlas_report_primitive_matrix: {},
  atlas_report_facilitator_responsibilities: {},
  atlas_report_govops_responsibilities: {},
  atlas_report_rewards: {},
  atlas_report_active_data: {},
};

test("ARGS fixture covers exactly the registered tool set (fails loudly on drift)", () => {
  expect(Object.keys(ARGS).sort()).toEqual(ATLAS_TOOLS.map((t) => t.name).sort());
});

test("every registered tool executes end-to-end via execToolDetailed without throwing", async () => {
  const ix = makeIx();
  for (const tool of ATLAS_TOOLS) {
    const args = ARGS[tool.name];
    const result = await execToolDetailed(ix, tool.name, JSON.stringify(args));
    expect(typeof result.content).toBe("string");
    expect(() => JSON.parse(result.content)).not.toThrow();
  }
});

test("execToolDetailed reports an error for an unknown tool name", async () => {
  const ix = makeIx();
  const result = await execToolDetailed(ix, "atlas_bogus_tool", "{}");
  expect(JSON.parse(result.content)).toEqual({ error: "unknown tool: atlas_bogus_tool" });
});

test("execToolDetailed reports invalid-argument errors from zod (missing required field)", async () => {
  const ix = makeIx();
  const result = await execToolDetailed(ix, "atlas_get", JSON.stringify({}));
  const parsed = JSON.parse(result.content) as Record<string, unknown>;
  expect(parsed.error).toBe("invalid tool arguments");
  expect(Array.isArray(parsed.details)).toBe(true);
});

test("execToolDetailed catches a throwing handler and returns its message as {error}", async () => {
  const ix = makeIx();
  const original = TOOLS_BY_NAME.get("atlas_describe")!;
  TOOLS_BY_NAME.set("atlas_describe", { ...original, handler: () => { throw new Error("boom"); } });
  try {
    const result = await execToolDetailed(ix, "atlas_describe", "{}");
    expect(JSON.parse(result.content)).toEqual({ error: "boom" });
  } finally {
    TOOLS_BY_NAME.set("atlas_describe", original);
  }
});
