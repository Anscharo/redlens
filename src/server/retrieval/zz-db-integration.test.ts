// DB-touching integration tests for the retrieval layer's two Postgres call
// sites: query.ts's historySet() (atlas_history, gated by since/until/
// change_type/recent_commits) and search.ts's runSemantic() (pgvector nearest-
// neighbor, gated by config.openrouterApiKey). Both are unreachable from
// query.test.ts / search.test.ts without a live DB, so they're mocked here.
//
// FILE NAME: the `zz-` prefix is historical. It was chosen on the belief that
// `bun test` walks files alphabetically and this one would therefore run last,
// after every other retrieval test had asserted against the real db module.
// THAT IS NOT TRUE — bun walks a directory in readdir order, which is
// filesystem-dependent. Dumping the real order here
// (`bun test src/server/retrieval --reporter=junit`) gives:
// entity-resolve, doc-rows, embed-text, query-schema, indexes, query, embed,
// search, zz-db-integration, entity-kind — i.e. a file DOES run after this one,
// and a fresh CI checkout can order it differently again. The name is kept only
// so the file keeps its identity in diffs/CI logs; nothing depends on it.
//
// So this file is written to be position-independent instead of lucky. bun's
// mock.module patches the module registry for the rest of the whole `bun test`
// run and `mock.restore()` does NOT undo it, so the registration below installs
// a Proxy that DELEGATES to the real db.ts client by default; the fake `unsafe`
// is only swapped in while this file's own tests run (armed in beforeEach,
// disarmed in afterEach/afterAll). Whatever runs after this file therefore sees
// the real client's behaviour, wherever bun decides to schedule it.
//
// Because `import { sql } from "../db.ts"` in query.ts/search.ts is a live ES
// module binding, replacing db.ts's `sql` export here is visible to those
// already-instantiated modules the next time they call `sql.unsafe(...)` — no
// dynamic re-import needed. (The dynamic imports below are kept anyway so the
// registration is guaranteed to precede first evaluation of query.ts.)
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { AtlasNode } from "./indexes.ts";

// Snapshot whatever db.ts currently exports and delegate to THAT. bun loads and
// runs test files one at a time (it does not preload every module body first),
// so "whatever is currently there" is the real module unless an earlier file
// already mock.module'd it — in which case delegating to the earlier mock is
// still the correct no-trace behaviour: we change nothing except while armed.
//
// The snapshot must be EAGER, into plain consts. A module namespace object is
// LIVE: once mock.module("../db.ts") lands, `ns.sql` resolves to the
// replacement — i.e. to our own dispatcher — so any delegation path that reads
// `ns.sql` at call time recurses into itself until the stack blows. `sql.reserve`
// did exactly that, and only a probe file loaded after this one caught it.
const baseNs = await import("../db.ts");
const baseExports: Record<string, unknown> = { ...baseNs };
const baseSql = baseNs.sql as unknown as Record<PropertyKey, unknown> | undefined;

type UnsafeImpl = (query: string, params?: unknown[]) => Promise<unknown[]>;
// null = disarmed: `sql.unsafe` falls through to the snapshotted client, so this
// registration is a behavioural no-op for any file that runs after us.
let unsafeImpl: UnsafeImpl | null = null;
let lastParams: unknown[] = [];

// The dispatcher is a REAL function rather than a Proxy over `baseSql`: some
// test files (migrate.test.ts) replace `sql` with a plain non-callable object,
// and a Proxy over a non-callable target is itself non-callable — which would
// break the tagged-template form for every file loaded after this one.
function sqlCall(...args: unknown[]): unknown {
  if (typeof baseSql !== "function") {
    throw new Error("db.ts `sql` is not callable — an earlier test file replaced it with a non-callable stub");
  }
  return (baseSql as (...a: unknown[]) => unknown)(...args);
}

const FN_OWN = new Set<PropertyKey>(["length", "name", "prototype", "constructor", "call", "apply", "bind"]);
const sqlDispatch = new Proxy(sqlCall, {
  get(target, prop, receiver) {
    const base = baseSql;
    if (prop === "unsafe") {
      return (query: string, params?: unknown[]) => {
        if (unsafeImpl) {
          lastParams = params ?? [];
          return unsafeImpl(query, params);
        }
        const passthrough = base?.unsafe;
        if (typeof passthrough !== "function") {
          throw new Error("db.ts sql.unsafe is unavailable — an earlier test file replaced db.ts without it");
        }
        return (passthrough as UnsafeImpl).call(base, query, params);
      };
    }
    if (base && !FN_OWN.has(prop)) {
      const v = base[prop];
      if (v !== undefined) return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(base) : v;
    }
    return Reflect.get(target, prop, receiver);
  },
});

mock.module("../db.ts", () => ({ ...baseExports, sql: sqlDispatch }));

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

// Arm the fake for our own cases only. `mock.restore()` cannot unregister the
// module patch (bun limitation), so disarming the impl is what actually makes
// this file safe for whatever bun schedules after it.
beforeEach(() => {
  unsafeImpl = () => Promise.resolve([]);
  lastParams = [];
});

afterEach(() => {
  unsafeImpl = null;
  lastParams = [];
});

afterAll(() => {
  unsafeImpl = null;
  mock.restore();
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

  it("does not throw when Bun returns member_ids as a Postgres uuid[] text literal", async () => {
    // Live bun SELECT of uuid[] yields `{uuid,uuid}`, not string[]. rewriteSemanticHit
    // used to call `.map` on that string and fail the e2e atlas_query smoke.
    const parent = node({
      id: "p",
      doc_no: "A.1.1",
      title: "Parent Instance",
      content: "parent body",
    });
    const child = node({
      id: "c",
      doc_no: "A.1.1.1",
      title: "Network",
      content: "Ethereum Mainnet",
    });
    const ix = buildIndexes([parent, child], [], [], { atlasCommit: "t" });
    unsafeImpl = (query) => {
      if (query.includes("ORDER BY e.embedding")) {
        return Promise.resolve([
          { id: "p", type: "Core", score: 0.95, member_ids: "{p,c}" },
        ]);
      }
      return Promise.resolve([]);
    };
    const res = await atlasQuery(ix, { q: "network", k: 10, enrich: false });
    const ids = (res.results as { id: string }[]).map((r) => r.id);
    expect(ids).toContain("c");
  });
});
