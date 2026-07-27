// DB-touching integration tests for the retrieval layer's two Postgres call
// sites: query.ts's historySet() (atlas_history, gated by since/until/
// change_type/recent_commits) and search.ts's runSemantic() (pgvector nearest-
// neighbor, gated by config.openrouterApiKey). Both are unreachable from
// query.test.ts / search.test.ts without a live DB, so they're mocked here.
//
// FILE NAME: intentionally sorts last (alphabetically "zz-...") among the
// retrieval test files. bun's mock.module patches the module registry for the
// rest of the whole `bun test` run, and other retrieval test files already
// import query.ts/search.ts (and transitively db.ts) with the REAL db module —
// running this file last means the mock only takes effect after every other
// retrieval test has already run and asserted against real artifacts. Because
// `import { sql } from "../db.ts"` in query.ts/search.ts is a live ES module
// binding, replacing db.ts's `sql` export here is visible to those
// already-instantiated modules the next time they call `sql.unsafe(...)` — no
// dynamic re-import needed.
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { AtlasNode } from "./indexes.ts";

type UnsafeImpl = (query: string, params?: unknown[]) => Promise<unknown[]>;
let unsafeImpl: UnsafeImpl = () => Promise.resolve([]);
let lastParams: unknown[] = [];

mock.module("../db.ts", () => ({
  sql: Object.assign(
    () => Promise.resolve([]), // tagged-template call form — unused by these two call sites
    {
      unsafe: (query: string, params?: unknown[]) => {
        lastParams = params ?? [];
        return unsafeImpl(query, params);
      },
    },
  ),
  toVectorLiteral: (vec: number[]) => `[${vec.join(",")}]`,
  dbTarget: () => "mock:0/mock",
  waitForDb: async () => {},
}));

const { buildIndexes } = await import("./indexes.ts");
const { atlasQuery } = await import("./query.ts");
const { config } = await import("../config.ts");

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

afterAll(() => {
  mock.restore();
});

afterEach(() => {
  unsafeImpl = () => Promise.resolve([]);
  lastParams = [];
});

describe("atlasQuery — history filters (DB-backed, mocked)", () => {
  it("since/until/change_type/recent_commits build an atlas_history query and constrain results", async () => {
    const a = node({ id: "a", title: "Alpha", content: "alpha content" });
    const b = node({ id: "b", title: "Beta", content: "beta content" });
    const ix = buildIndexes([a, b], [], [], { atlasCommit: "t" });

    unsafeImpl = (query) => {
      expect(query).toContain("atlas_history");
      return Promise.resolve([{ doc_id: "a" }]);
    };

    const res = await atlasQuery(ix, { target_type: "Core", since: "30d", k: 10, enrich: false });
    expect((res.results as { id: string }[]).map((r) => r.id)).toEqual(["a"]);
  });

  it("recent_commits and change_type both add WHERE conditions with positional params", async () => {
    const a = node({ id: "a" });
    const ix = buildIndexes([a], [], [], { atlasCommit: "t" });
    let capturedParams: unknown[] = [];
    unsafeImpl = (query, params) => {
      capturedParams = params ?? [];
      expect(query).toContain("commit_seq >=");
      expect(query).toContain("change_type =");
      return Promise.resolve([{ doc_id: "a" }]);
    };
    const res = await atlasQuery(ix, { target_type: "Core", recent_commits: 5, change_type: "content", k: 10, enrich: false });
    expect(capturedParams).toEqual([5, "content"]);
    expect((res.results as { id: string }[]).map((r) => r.id)).toEqual(["a"]);
  });

  it("resolves a relative '30d' since into an ISO date param, not the literal string", async () => {
    const a = node({ id: "a" });
    const ix = buildIndexes([a], [], [], { atlasCommit: "t" });
    unsafeImpl = () => Promise.resolve([]);
    await atlasQuery(ix, { target_type: "Core", since: "30d", k: 10, enrich: false });
    expect(lastParams[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("an absolute ISO since passes through resolveSince unchanged", async () => {
    const a = node({ id: "a" });
    const ix = buildIndexes([a], [], [], { atlasCommit: "t" });
    unsafeImpl = () => Promise.resolve([]);
    await atlasQuery(ix, { target_type: "Core", since: "2024-01-01", k: 10, enrich: false });
    expect(lastParams[0]).toBe("2024-01-01");
  });

  it("history + status + ancestor_id filters intersect (AND) rather than union", async () => {
    const root = node({ id: "root", doc_no: "A", parentId: null });
    const inScope = node({ id: "in-scope", doc_no: "A.1", parentId: "root", content: "Status: Active." });
    const outScope = node({ id: "out-scope", doc_no: "B.1", parentId: null, content: "Status: Active." });
    const ix = buildIndexes([root, inScope, outScope], [], [], { atlasCommit: "t" });
    // History says both changed; status says both Active; ancestor_id restricts to root's descendants.
    unsafeImpl = () => Promise.resolve([{ doc_id: "in-scope" }, { doc_id: "out-scope" }]);
    const res = await atlasQuery(ix, {
      target_type: "Core",
      since: "30d",
      status: "Active",
      ancestor_id: "root",
      k: 10,
      enrich: false,
    });
    expect((res.results as { id: string }[]).map((r) => r.id)).toEqual(["in-scope"]);
  });
});

describe("atlasQuery — semantic search leg (DB-backed, mocked)", () => {
  const realFetch = globalThis.fetch;
  let prevKey: string;

  beforeEach(() => {
    prevKey = config.openrouterApiKey;
    config.openrouterApiKey = "test-key";
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: [{ embedding: [1, 0, 0], index: 0 }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
  });

  afterEach(() => {
    config.openrouterApiKey = prevKey;
    globalThis.fetch = realFetch;
  });

  it("merges semantic hits (pgvector rows) with lexical hits via RRF", async () => {
    const lexOnly = node({ id: "lex-only", title: "Lexical Match Only", content: "unique lexical phrase zzqx" });
    const semOnly = node({ id: "sem-only", title: "Semantic Only", content: "totally unrelated wording" });
    const ix = buildIndexes([lexOnly, semOnly], [], [], { atlasCommit: "t" });

    unsafeImpl = (query) => {
      expect(query).toContain("atlas_doc_embeddings");
      return Promise.resolve([{ id: "sem-only", type: "Core", score: 0.9 }]);
    };

    const res = await atlasQuery(ix, { q: "zzqx", k: 10, enrich: false });
    const ids = (res.results as { id: string; sources: string[] }[]).map((r) => r.id);
    expect(ids).toContain("lex-only");
    expect(ids).toContain("sem-only");
    const semRow = (res.results as { id: string; sources: string[] }[]).find((r) => r.id === "sem-only")!;
    expect(semRow.sources).toEqual(["semantic"]);
  });

  it("stops collecting semantic rows once the score falls below semanticMinScore", async () => {
    const a = node({ id: "a", title: "A" });
    const b = node({ id: "b", title: "B" });
    const ix = buildIndexes([a, b], [], [], { atlasCommit: "t" });
    const prevMin = config.semanticMinScore;
    config.semanticMinScore = 0.5;
    try {
      unsafeImpl = () =>
        Promise.resolve([
          { id: "a", type: "Core", score: 0.9 },
          { id: "b", type: "Core", score: 0.1 }, // below floor — and everything after it too
        ]);
      const res = await atlasQuery(ix, { q: "anything", k: 10, enrich: false });
      const ids = (res.results as { id: string }[]).map((r) => r.id);
      expect(ids).toContain("a");
      expect(ids).not.toContain("b");
    } finally {
      config.semanticMinScore = prevMin;
    }
  });

  it("a semantic-leg failure degrades to lexical-only instead of failing the whole query", async () => {
    const a = node({ id: "a", title: "Alpha", content: "alpha wording" });
    const ix = buildIndexes([a], [], [], { atlasCommit: "t" });
    unsafeImpl = () => Promise.reject(new Error("pgvector down"));
    const res = await atlasQuery(ix, { q: "alpha", k: 10, enrich: false });
    const ids = (res.results as { id: string }[]).map((r) => r.id);
    expect(ids).toContain("a");
  });
});
