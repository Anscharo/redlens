// Pure tests for the tool-choice eval's grading (eval-tools-score.ts), plus the
// label hygiene of the case set itself against the LIVE tool registry — a
// renamed tool or atlas_query param must fail here, not silently score every
// run as a miss. Runs under `bun test` (test:server): the registry import
// reaches Bun's SQL client.
import { beforeAll, describe, expect, it } from "bun:test";
import { CHAT_TOOLS } from "../../src/server/chat/tools/llm-tools.ts";
import { atlasQueryShape } from "../../src/server/retrieval/query-schema.ts";
import { loadIndexes, type Indexes } from "../../src/server/retrieval/indexes.ts";
import { TOOL_CASES } from "./eval-tools-cases.ts";
import { resolveCase } from "./eval-tools-run.ts";
import {
  NO_TOOL, atlasQueryExtra, emptiedByFilters, isEmptyResult, scoreRun, signTestP, validateCases,
  type ObservedCall, type ToolCase,
} from "./eval-tools-score.ts";

const call = (name: string, round = 0, extra: Partial<ObservedCall> = {}): ObservedCall =>
  ({ name, args: {}, round, ok: true, empty: false, emptyByFilters: false, ...extra });
const tc = (over: Partial<ToolCase>): ToolCase => ({ id: "t", category: "t", q: "?", acceptFirst: ["atlas_query"], note: "", ...over });

describe("atlasQueryExtra", () => {
  it("separates the fill-every-field shape from params that actually filter", () => {
    // The dev-DB shape: empty strings/arrays alongside real enum/number values.
    const args = { query: "x", k: 10, entity: "", status: "", edge_types: [], since: "", recent_commits: 5, change_type: "content", direction: "both", include_params: false };
    expect(atlasQueryExtra(args)).toEqual({
      present: ["change_type", "direction", "edge_types", "entity", "include_params", "recent_commits", "since", "status"],
      effective: ["change_type", "recent_commits"], // direction "both" is the schema default
    });
  });
  it("honours the case allowance on top of query/q/k/enrich", () => {
    expect(atlasQueryExtra({ q: "x", enrich: true, entity: "spark", status: "Active" }, ["entity"])).toEqual({ present: ["status"], effective: ["status"] });
    expect(atlasQueryExtra({ query: "x", direction: "out" }).effective).toEqual(["direction"]);
  });
});

describe("isEmptyResult / emptiedByFilters", () => {
  it("reads zero counts and empty list envelopes as empty", () => {
    expect(isEmptyResult(JSON.stringify({ count: 0, results: [] }))).toBe(true);
    expect(isEmptyResult(JSON.stringify({ report: "x", total: 0, rows: [] }))).toBe(true);
    expect(isEmptyResult(JSON.stringify({ mode: "entity_broad", by_relationship: {} }))).toBe(true);
    expect(isEmptyResult(JSON.stringify({ commit_a: "a", doc_count: 0, docs: [] }))).toBe(true);
  });
  it("never reads errors, truncation, unknown shapes or partial lists as empty", () => {
    expect(isEmptyResult(JSON.stringify({ error: "Not found" }))).toBe(false);
    expect(isEmptyResult(JSON.stringify({ truncated: true, preview_json: "{}" }))).toBe(false);
    expect(isEmptyResult(JSON.stringify({ id: "u", title: "t" }))).toBe(false);
    expect(isEmptyResult(JSON.stringify({ nodes: [], addresses: [{ address: "0x1" }] }))).toBe(false);
    expect(isEmptyResult(JSON.stringify({ count: 2, results: [{}, {}] }))).toBe(false);
    expect(isEmptyResult("not json")).toBe(false);
  });
  it("spots atlas_query's own filters-emptied-this envelope", () => {
    expect(emptiedByFilters(JSON.stringify({ count: 0, filters_applied: ["recent_commits=5"], results: [] }))).toBe(true);
    expect(emptiedByFilters(JSON.stringify({ count: 0, results: [] }))).toBe(false);
  });
});

describe("scoreRun", () => {
  it("scores the FIRST round only, any parallel call there counting", () => {
    const c = tc({ acceptFirst: ["atlas_report_multisigs"] });
    expect(scoreRun(c, [call("atlas_query", 0), call("atlas_report_multisigs", 0)]).firstOk).toBe(true);
    expect(scoreRun(c, [call("atlas_query", 0), call("atlas_report_multisigs", 1)]).firstOk).toBe(false);
    expect(scoreRun(c, [call("atlas_query", 0), call("atlas_get", 0)]).firstCalls).toEqual(["atlas_query", "atlas_get"]);
  });
  it("[] means no tool is correct; NO_TOOL makes it one acceptable option", () => {
    expect(scoreRun(tc({ acceptFirst: [] }), []).firstOk).toBe(true);
    expect(scoreRun(tc({ acceptFirst: [] }), [call("atlas_query")]).firstOk).toBe(false);
    expect(scoreRun(tc({ acceptFirst: ["atlas_query"] }), []).firstOk).toBe(false);
    expect(scoreRun(tc({ acceptFirst: [NO_TOOL, "atlas_describe"] }), []).firstOk).toBe(true);
    expect(scoreRun(tc({ acceptFirst: [NO_TOOL, "atlas_describe"] }), [call("atlas_describe")]).firstOk).toBe(true);
  });
  it("acceptFirstAfterDocFacts opens only when a document-carrying fact fired on that run", () => {
    const c = tc({ acceptFirst: ["atlas_query", "atlas_search"], acceptFirstAfterDocFacts: ["atlas_get"] });
    const get = [call("atlas_get")];
    expect(scoreRun(c, get, ["glossary", "roles"]).firstOk).toBe(true);
    expect(scoreRun(c, get, ["entities"]).firstOk).toBe(true);
    expect(scoreRun(c, get, ["censuses", "features"]).firstOk).toBe(false); // no doc uuids in either
    expect(scoreRun(c, get, []).firstOk).toBe(false);
    expect(scoreRun(c, [call("atlas_query")], []).firstOk).toBe(true);
  });
  it("acceptAny and forbid read the whole turn and gate allOk", () => {
    const c = tc({ acceptFirst: ["atlas_entities"], acceptAny: ["atlas_entity"], forbid: ["export_findings"] });
    expect(scoreRun(c, [call("atlas_entities", 0), call("atlas_entity", 1)]).allOk).toBe(true);
    expect(scoreRun(c, [call("atlas_entities", 0)])).toMatchObject({ firstOk: true, anyOk: false, allOk: false });
    expect(scoreRun(c, [call("atlas_entities", 0), call("atlas_entity", 1), call("export_findings", 2)])).toMatchObject({ forbiddenCalled: ["export_findings"], allOk: false });
  });
  it("counts errors, empties and atlas_query extras per call", () => {
    const s = scoreRun(tc({}), [
      call("atlas_query", 0, { args: { query: "x", status: "Active" }, empty: true, emptyByFilters: true }),
      call("atlas_get", 1, { ok: false }),
    ]);
    expect(s).toMatchObject({ toolCalls: 2, toolErrors: 1, emptyResults: 1, emptyByFilters: 1, aqCalls: 1 });
    expect(s.aqExtra).toEqual([{ present: ["status"], effective: ["status"] }]);
  });
});

describe("signTestP", () => {
  it("is the exact two-sided binomial tail over discordant pairs", () => {
    expect(signTestP(0, 0)).toBe(1);
    expect(signTestP(5, 0)).toBeCloseTo(2 / 32);
    expect(signTestP(6, 0)).toBeCloseTo(2 / 64);
    expect(signTestP(0, 6)).toBeCloseTo(2 / 64);
    expect(signTestP(3, 3)).toBe(1);
    expect(signTestP(8, 2)).toBeCloseTo((2 * (1 + 10 + 45)) / 1024);
  });
});

describe("the case set", () => {
  let ix: Indexes;
  beforeAll(() => {
    ix = loadIndexes();
  });
  it("names only live tools and atlas_query params, with unique ids", () => {
    const tools = new Set(CHAT_TOOLS.flatMap((t) => (t.type === "function" ? [t.function.name] : [])));
    expect(validateCases(TOOL_CASES, tools, new Set(Object.keys(atlasQueryShape)))).toEqual([]);
    expect(validateCases([tc({ acceptFirst: ["atlas_nope"] })], tools, new Set())).toEqual(["t: unknown tool atlas_nope"]);
  });
  it("every uuid a case refers to is in the served atlas", () => {
    for (const c of TOOL_CASES) expect(() => resolveCase(ix, c)).not.toThrow();
    const ers = TOOL_CASES.find((c) => c.id === "hist-first-seen")!;
    expect(resolveCase(ix, ers).q).not.toContain("{doc_no:");
  });
});
