// Collection group names: the pure prompt half (titles tallied, scopes counted,
// the answer parsed) and the route (ownership, cache by id hash, misses not
// stored). The model is the injectable JsonCall; db.ts is an in-memory fake.
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { toUuidArrayLiteral, fromUuidArray } from "./pg-array.ts";
import type { JsonCall } from "./chat/llm.ts";
import type { AtlasNode } from "../types.ts";

type Row = Record<string, unknown>;
let queryLog: { text: string; values: unknown[] }[] = [];
let stored: Row | null = null;
let itemIds: string[] = [];
let failDb = false;

function query(strings: TemplateStringsArray, ...values: unknown[]): Promise<Row[]> {
  const text = strings.join("?").replace(/\s+/g, " ").trim();
  queryLog.push({ text, values });
  if (failDb) return Promise.reject(new Error("db down"));
  if (text.includes("SELECT summary_label")) return Promise.resolve(stored ? [stored] : []);
  if (text.includes("SELECT doc_id FROM collection_items")) return Promise.resolve(itemIds.map((doc_id) => ({ doc_id })));
  return Promise.resolve([]);
}

// `unsafe` exists because bun leaks this module mock into later test files, and
// some of them spy on it (search-semantic.test.ts).
const sqlMock = Object.assign(query, { unsafe: () => Promise.resolve([] as Row[]) });

mock.module("./db.ts", () => ({
  sql: sqlMock,
  dbTarget: () => "mock-db",
  waitForDb: () => Promise.resolve(),
  toVectorLiteral: (vec: number[]) => `[${vec.join(",")}]`,
  toUuidArrayLiteral,
  fromUuidArray,
}));

const { buildSummaryPrompt, idsHash, parseSummary, summaryInput } = await import("./collection-summary-prompt.ts");
const { handleCollectionSummary, summarizeIds } = await import("./collection-summary.ts");
const { config } = await import("./config.ts");
const { signSession, SESSION_COOKIE } = await import("./session.ts");

const node = (id: string, title: string, parentId: string | null): AtlasNode =>
  ({ id, doc_no: id, title, type: "Core", depth: 0, parentId, content: "", order: 0, addressRefs: [] }) as AtlasNode;
const DOCS = [
  node("scope-a", "Stability Scope", null),
  node("scope-b", "Support Scope", null),
  node("a1", "Rate Limits", "scope-a"),
  node("a2", "Rate Limits", "scope-a"),
  node("b1", "Oracle Policy", "scope-b"),
];

// Passed in, never installed globally: other test files share the real indexes.
const IX = { docMap: new Map(DOCS.map((d) => [d.id, d])) } as never;

const origSecret = config.jwtSecret;
const origModel = config.chatTitleModel;
beforeAll(() => {
  config.jwtSecret = "test-secret-0123456789abcdef0123456789abcdef";
});
afterAll(() => {
  config.jwtSecret = origSecret;
  config.chatTitleModel = origModel;
  mock.restore();
});
beforeEach(() => {
  queryLog = [];
  stored = null;
  itemIds = ["a1", "a2", "b1"];
  failDb = false;
  config.chatTitleModel = "test/model";
});

const answer = (text: string): JsonCall => async () => ({ text, usage: { input: 1, output: 1 }, generationId: null, latencyMs: 1 });
const GOOD = answer('{"label":"Rate and oracle rules","summary":"Rate limits and oracle policy."}');
const COLLECTION_ID = "22222222-2222-2222-2222-222222222222";

async function get(path: string, call: JsonCall, method = "GET", authed = true): Promise<Response> {
  const token = await signSession({ id: "user-1", provider: "github" });
  const headers = authed ? { cookie: `${SESSION_COOKIE}=${token}` } : undefined;
  return handleCollectionSummary(new Request(`http://x${path}`, { method, headers }), { call, ix: IX });
}

describe("summaryInput + buildSummaryPrompt", () => {
  it("counts top-level scopes and repeats of a title", () => {
    const input = summaryInput(IX, ["a1", "a2", "b1", "gone"]);
    expect(input.total).toBe(3);
    expect(input.scopes).toEqual([
      { title: "Stability Scope", count: 2 },
      { title: "Support Scope", count: 1 },
    ]);
    expect(input.titles[0]).toEqual({ title: "Rate Limits", count: 2 });
  });

  it("writes repeats as ×N and says how many documents are not listed", () => {
    const text = String(buildSummaryPrompt({ total: 9, scopes: [{ title: "S", count: 9 }], titles: [{ title: "Rate Limits", count: 2 }] })[1].content);
    expect(text).toContain("Rate Limits ×2");
    expect(text).toContain("and 7 more documents");
  });

  it("uses a node's own title as its scope when it has no parent", () => {
    const input = summaryInput(IX, ["scope-a"]);
    expect(input.scopes).toEqual([{ title: "Stability Scope", count: 1 }]);
  });
});

describe("idsHash", () => {
  it("ignores order and changes with the docs", () => {
    expect(idsHash(["a", "b"])).toBe(idsHash(["b", "a"]));
    expect(idsHash(["a", "b"])).not.toBe(idsHash(["a"]));
  });
});

describe("parseSummary", () => {
  it("reads JSON, fences and over-long fields", () => {
    expect(parseSummary('```json\n{"label":"“A very long label for a group today”.","summary":" One  sentence. "}\n```')).toEqual({
      label: "A very long label for",
      summary: "One sentence.",
    });
  });

  it("is null for prose, missing fields or empty values", () => {
    expect(parseSummary("sure, here you go")).toBeNull();
    expect(parseSummary('{"label":"x"}')).toBeNull();
    expect(parseSummary('{"label":" ","summary":"y"}')).toBeNull();
  });
});

describe("summarizeIds", () => {
  it("is null with the model off, no ids, or no known docs", async () => {
    config.chatTitleModel = "";
    expect(await summarizeIds(["a1"], { call: GOOD, ix: IX })).toBeNull();
    config.chatTitleModel = "test/model";
    expect(await summarizeIds([], { call: GOOD, ix: IX })).toBeNull();
    expect(await summarizeIds(["gone"], { call: GOOD, ix: IX })).toBeNull();
  });

  it("is null when the call fails", async () => {
    const failing: JsonCall = async () => {
      throw new Error("provider down");
    };
    expect(await summarizeIds(["a1"], { call: failing, ix: IX })).toBeNull();
  });
});

describe("GET /api/collections/:id/summary", () => {
  it("401s without a session, 405s other methods, 404s a bad id", async () => {
    expect((await get(`/api/collections/${COLLECTION_ID}/summary`, GOOD, "GET", false)).status).toBe(401);
    expect((await get(`/api/collections/${COLLECTION_ID}/summary`, GOOD, "POST")).status).toBe(405);
    expect((await get("/api/collections/nope/summary", GOOD)).status).toBe(404);
  });

  it("404s a collection the caller does not own", async () => {
    expect((await get(`/api/collections/${COLLECTION_ID}/summary`, GOOD)).status).toBe(404);
  });

  it("writes, stores and returns a summary for a new doc set", async () => {
    stored = { summary_label: null, summary_text: null, summary_hash: null };
    const res = await get(`/api/collections/${COLLECTION_ID}/summary`, GOOD);
    expect(await res.json()).toEqual({ label: "Rate and oracle rules", summary: "Rate limits and oracle policy." });
    const update = queryLog.find((q) => q.text.startsWith("UPDATE collections SET summary_label"));
    expect(update?.values).toEqual(["Rate and oracle rules", "Rate limits and oracle policy.", idsHash(itemIds), COLLECTION_ID, "user-1"]);
  });

  it("returns the stored summary without a model call while the docs are unchanged", async () => {
    stored = { summary_label: "Saved label", summary_text: "Saved text.", summary_hash: idsHash(itemIds) };
    const never: JsonCall = async () => {
      throw new Error("must not be called");
    };
    const res = await get(`/api/collections/${COLLECTION_ID}/summary`, never);
    expect(await res.json()).toEqual({ label: "Saved label", summary: "Saved text." });
  });

  it("rewrites a summary whose docs changed", async () => {
    stored = { summary_label: "Old", summary_text: "Old text.", summary_hash: "stale" };
    const res = await get(`/api/collections/${COLLECTION_ID}/summary`, GOOD);
    expect(((await res.json()) as { label: string }).label).toBe("Rate and oracle rules");
  });

  it("answers nulls and stores nothing on a model miss", async () => {
    stored = { summary_label: null, summary_text: null, summary_hash: null };
    const res = await get(`/api/collections/${COLLECTION_ID}/summary`, answer("not json"));
    expect(await res.json()).toEqual({ label: null, summary: null });
    expect(queryLog.some((q) => q.text.startsWith("UPDATE"))).toBe(false);
  });

  it("500s when the database fails", async () => {
    failDb = true;
    expect((await get(`/api/collections/${COLLECTION_ID}/summary`, GOOD)).status).toBe(500);
  });

  it("answers nulls for a collection with no documents", async () => {
    stored = { summary_label: null, summary_text: null, summary_hash: null };
    itemIds = [];
    expect(await (await get(`/api/collections/${COLLECTION_ID}/summary`, GOOD)).json()).toEqual({ label: null, summary: null });
  });
});
