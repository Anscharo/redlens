import { afterAll, afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { sql } from "./db.ts";
import { _clearQueryEmbedCache } from "./retrieval/embed.ts";
import { config } from "./config.ts";
import {
  SEMANTIC_K_DEFAULT,
  SEMANTIC_K_MAX,
  clampK,
  handleSemanticSearch,
  semanticDocSearch,
  semanticLaneShown,
  semanticSearchAvailable,
  toWireHits,
} from "./search-semantic.ts";
import type { SemanticSearchResponse } from "../lib/searchSemantic.ts";
import { _clearIndexes, buildIndexes, getIndexes, setIndexes } from "./retrieval/indexes.ts";
import { _resetSemanticBudget } from "./search-semantic-limit.ts";
import type { AtlasNode, Indexes } from "./retrieval/indexes.ts";

// config is a plain mutable object; restore whatever this process actually has
// so no later test file in the same `bun test` run inherits our value.
const REAL_KEY = config.openrouterApiKey;
const REAL_RPM = config.searchSemanticRpm;
afterEach(() => {
  config.openrouterApiKey = REAL_KEY;
  config.searchSemanticRpm = REAL_RPM;
  // The budget is process-wide: a case that drains it would otherwise 429
  // every later case in this file, and the one after it in the run.
  _resetSemanticBudget();
});

async function get(qs: string): Promise<SemanticSearchResponse> {
  const res = await handleSemanticSearch(new Request(`http://x/api/search/semantic${qs}`));
  expect(res.status).toBe(200);
  return (await res.json()) as SemanticSearchResponse;
}

describe("clampK", () => {
  it("defaults, floors and caps", () => {
    expect(clampK(null)).toBe(SEMANTIC_K_DEFAULT);
    expect(clampK("")).toBe(SEMANTIC_K_DEFAULT);
    expect(clampK("abc")).toBe(SEMANTIC_K_DEFAULT);
    expect(clampK("0")).toBe(SEMANTIC_K_DEFAULT);
    expect(clampK("-5")).toBe(SEMANTIC_K_DEFAULT);
    expect(clampK("10")).toBe(10);
    expect(clampK("10.6")).toBe(11);
    // An unbounded k would be one pgvector row per unit in the whole corpus.
    expect(clampK("99999")).toBe(SEMANTIC_K_MAX);
  });
});

describe("toWireHits", () => {
  const docMap = new Map<string, unknown>([["a", 1], ["b", 1], ["c", 1]]);

  it("keeps order, drops duplicate leaves, and caps at k", () => {
    const hits = toWireHits(
      [
        { id: "a", score: 0.9 },
        { id: "a", score: 0.8 }, // second anchor attributed to the same leaf
        { id: "b", score: 0.7 },
        { id: "c", score: 0.6 },
      ],
      docMap,
      2,
    );
    expect(hits).toEqual([
      { id: "a", score: 0.9 },
      { id: "b", score: 0.7 },
    ]);
  });

  it("drops ids the client's doc map cannot resolve", () => {
    // A doc the served artifacts don't have (sha skew) would occupy a slot and
    // then vanish during hydration — worse than never being sent.
    const hits = toWireHits([{ id: "zz", score: 0.9 }, { id: "b", score: 0.5 }], docMap, 5);
    expect(hits).toEqual([{ id: "b", score: 0.5 }]);
  });

  it("reports viaTitle only for a child attribution", () => {
    const [child, group] = toWireHits(
      [
        { id: "a", score: 0.9, via: { group_id: "g", group_title: "Fluid sUSDS Vault", match_scope: "child" } },
        { id: "b", score: 0.8, via: { group_id: "g", group_title: "Fluid sUSDS Vault", match_scope: "group" } },
      ],
      docMap,
      5,
    );
    expect(child).toEqual({ id: "a", score: 0.9, viaTitle: "Fluid sUSDS Vault" });
    // The anchor itself matched, so its title IS this hit's title — repeating
    // it as "via …" would be noise.
    expect(group).toEqual({ id: "b", score: 0.8 });
  });
});

describe("availability", () => {
  it("follows the embedding key", () => {
    config.openrouterApiKey = "";
    expect(semanticSearchAvailable()).toBe(false);
    config.openrouterApiKey = "sk-test";
    expect(semanticSearchAvailable()).toBe(true);
  });

  it("offers the search bar's lane only on a model quick enough to answer while typing", () => {
    const { embedModel: model, openrouterApiKey: key } = config;
    try {
      config.openrouterApiKey = "sk-test";
      config.embedModel = "google/gemini-embedding-2";
      expect(semanticLaneShown()).toBe(true);
      config.embedModel = "qwen/qwen3-embedding-8b";
      expect(semanticLaneShown()).toBe(false);
      expect(semanticSearchAvailable()).toBe(true);
      config.embedModel = "google/gemini-embedding-2";
      config.openrouterApiKey = "";
      expect(semanticLaneShown()).toBe(false);
    } finally {
      config.embedModel = model;
      config.openrouterApiKey = key;
    }
  });

  it("answers 200 with available:false rather than 404 when unconfigured", async () => {
    // A 404 would be indistinguishable from "this route doesn't exist", and the
    // UI needs to be able to say WHY the lane is missing.
    config.openrouterApiKey = "";
    expect(await get("?q=who%20approves%20rewards")).toEqual({ hits: [], skipped: null, available: false });
  });

  it("never reports a missing key as a degraded leg", async () => {
    config.openrouterApiKey = "";
    expect((await get("?q=governance")).skipped).toBeNull();
  });
});

describe("in: scoping", () => {
  it("reaches semanticDocSearch upper-cased, and degrades like any other query", async () => {
    config.openrouterApiKey = "";
    const res = await handleSemanticSearch(
      new Request("http://x/api/search/semantic?q=who%20approves&in=a.6.1"),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hits: [], skipped: null, available: false });
  });

  it("is absent, not empty-string, when no scope was asked for", async () => {
    // An empty `in=` must not become a scope that matches nothing.
    config.openrouterApiKey = "";
    const res = await handleSemanticSearch(new Request("http://x/api/search/semantic?q=who%20approves&in="));
    expect(res.status).toBe(200);
    expect(((await res.json()) as SemanticSearchResponse).hits).toEqual([]);
  });
});

describe("query guards", () => {
  it("returns nothing, and embeds nothing, for a query too short to score", async () => {
    // A real key is set here: reaching the embed would be a network call.
    config.openrouterApiKey = "sk-test";
    expect(await get("?q=ab")).toEqual({ hits: [], skipped: null, available: true });
    expect(await get("?q=")).toEqual({ hits: [], skipped: null, available: true });
    expect(await get("")).toEqual({ hits: [], skipped: null, available: true });
    expect(await get("?q=%20%20%20")).toEqual({ hits: [], skipped: null, available: true });
  });

  it("passes k and type through without throwing", async () => {
    config.openrouterApiKey = "";
    const body = await semanticDocSearch("liquidation penalties", { k: 5, type: "Core" });
    expect(body).toEqual({ hits: [], skipped: null, available: false });
  });
});

// ── the whole pipeline, with the embed failing ──────────────────────────────
//
// Everything between the key check and the response — the over-fetch sizing,
// the lexical leg that feeds leaf attribution, the type and scope filters —
// only runs with indexes loaded, and until now nothing exercised it: the cases
// above all stop at the key check. The embed is failed deliberately (a 1ms
// budget, the same lever src/server/retrieval/search.test.ts pulls) rather than
// stubbed into succeeding, because that is the only way to reach this code
// without a database AND without a network call: `runSemantic` swallows its own
// failure, so the rest of the pipeline runs exactly as it does in production
// with a degraded leg.
const node = (id: string, doc_no: string, title: string): AtlasNode =>
  ({ id, doc_no, title, type: "Core", depth: 2, parentId: null, order: 0, content: `${title} body` }) as AtlasNode;

describe("with indexes loaded", () => {
  let prevIx: Indexes | null = null;
  const prevTimeout = config.semanticEmbedTimeoutMs;
  const prevFetch = globalThis.fetch;

  beforeAll(() => {
    try {
      prevIx = getIndexes();
    } catch {
      prevIx = null; // cold — restore to cold, not to a fixture
    }
    setIndexes(buildIndexes([node("d1", "A.6.1", "Rewards"), node("d2", "A.2.1", "Quorum")], [], [], { atlasCommit: "test" }));
    // The 1ms budget below is what fails the embed; this is what keeps it from
    // leaving the process while it does.
    globalThis.fetch = (() => Promise.reject(new Error("no network in tests"))) as unknown as typeof fetch;
  });
  afterAll(() => {
    if (prevIx) setIndexes(prevIx);
    else _clearIndexes();
    config.semanticEmbedTimeoutMs = prevTimeout;
    globalThis.fetch = prevFetch;
  });

  it("degrades to an empty, reason-carrying answer when the embed fails", async () => {
    config.openrouterApiKey = "sk-test";
    config.semanticEmbedTimeoutMs = 1;
    const body = await semanticDocSearch("who approves rewards", { k: 5 });
    expect(body.available).toBe(true);
    expect(body.hits).toEqual([]);
    // The reason is the leg's own, not an exception: the reader keeps whatever
    // is on screen and is told why there is nothing new.
    expect(body.skipped).toMatch(/timed out|embed/i);
  });

  it("answers 200 with the reason when something OUTSIDE the leg throws", async () => {
    // A cold boot: the route can be hit before the indexes are loaded. The
    // leg's own failures never reach here (runSemantic swallows them), so a
    // throw means the server, not the search — and the reader must keep the
    // results already on screen rather than have them replaced by an error.
    config.openrouterApiKey = "sk-test";
    const loaded = getIndexes();
    _clearIndexes();
    try {
      const res = await handleSemanticSearch(new Request("http://x/api/search/semantic?q=who%20approves"));
      expect(res.status).toBe(200);
      const body = (await res.json()) as SemanticSearchResponse;
      expect(body.hits).toEqual([]);
      expect(body.skipped).toMatch(/indexes not loaded/);
      expect(body.available).toBe(true);
    } finally {
      setIndexes(loaded);
    }
  });

  it("answers a scoped query the same way, over-fetching rather than 404ing", async () => {
    // A scope filters AFTER the nearest-neighbour cut, which is why the query
    // asks for more than k — and a degraded leg must still answer 200.
    config.openrouterApiKey = "sk-test";
    config.semanticEmbedTimeoutMs = 1;
    const res = await handleSemanticSearch(
      new Request("http://x/api/search/semantic?q=who%20approves%20rewards&in=a.6&type=Core&k=5"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as SemanticSearchResponse;
    expect(body.hits).toEqual([]);
    expect(body.skipped).toBeTruthy();
  });

  it("surfaces a document only a briefing found", async () => {
    config.openrouterApiKey = "sk-test";
    config.semanticEmbedTimeoutMs = 5_000;
    _clearQueryEmbedCache();
    globalThis.fetch = ((_u: string, init: { body: string }) => {
      const input = (JSON.parse(init.body) as { input: string[] }).input;
      return Promise.resolve(
        new Response(JSON.stringify({ data: input.map((_t, i) => ({ index: i, embedding: Array.from({ length: 1024 }, () => 0.02) })) }), {
          status: 200, headers: { "content-type": "application/json" },
        }),
      );
    }) as unknown as typeof fetch;
    const spy = spyOn(sql, "unsafe").mockImplementation(((text: string) =>
      Promise.resolve(
        text.includes("atlas_doc_briefings")
          ? [{ id: "d2", score: 0.9 }]
          : [{ id: "d1", type: "Core", score: 0.7, member_ids: null }],
      )) as unknown as typeof sql.unsafe);
    try {
      const body = await semanticDocSearch("which quorum applies", { k: 5 });
      expect(body.skipped).toBeNull();
      expect(body.hits.map((h) => h.id).sort()).toEqual(["d1", "d2"]);
      expect(body.hits.find((h) => h.id === "d2")!.score).toBe(0.9);
    } finally {
      spy.mockRestore();
      _clearQueryEmbedCache();
    }
  });

  it("returns nothing for an off-topic query whose rows all sit under the floor", async () => {
    config.openrouterApiKey = "sk-test";
    config.semanticEmbedTimeoutMs = 5_000;
    _clearQueryEmbedCache();
    globalThis.fetch = ((_u: string, init: { body: string }) => {
      const input = (JSON.parse(init.body) as { input: string[] }).input;
      return Promise.resolve(
        new Response(JSON.stringify({ data: input.map((_t, i) => ({ index: i, embedding: Array.from({ length: 1024 }, () => 0.02) })) }), {
          status: 200, headers: { "content-type": "application/json" },
        }),
      );
    }) as unknown as typeof fetch;
    const below = config.semanticMinScore - 0.01;
    const spy = spyOn(sql, "unsafe").mockImplementation(((text: string) =>
      Promise.resolve(
        text.includes("atlas_doc_briefings")
          ? [{ id: "d2", score: below }]
          : [{ id: "d1", type: "Core", score: below, member_ids: null }],
      )) as unknown as typeof sql.unsafe);
    try {
      const body = await semanticDocSearch("best pizza in naples", { k: 5 });
      expect(body.skipped).toBeNull();
      expect(body.hits).toEqual([]);
    } finally {
      spy.mockRestore();
      _clearQueryEmbedCache();
    }
  });
});

describe("the shared budget", () => {
  // Installed here rather than inherited: whether `getIndexes()` throws decides
  // whether the request stops at the gate or runs on into `runSemantic`, and
  // which it does depended on what an earlier file in the same `bun test`
  // process happened to leave behind. It cost two 5s CI timeouts — locally the
  // indexes were clear, so the embed was never reached; in CI they were set, so
  // a live OpenRouter call ran into its 1+2+4+8s retry backoff. State this test
  // depends on is now stated by this test.
  let prevIx: Indexes | null = null;
  const prevFetch = globalThis.fetch;
  const prevTimeout = config.semanticEmbedTimeoutMs;

  beforeAll(() => {
    try {
      prevIx = getIndexes();
    } catch {
      prevIx = null;
    }
    setIndexes(buildIndexes([node("d1", "A.6.1", "Rewards")], [], [], { atlasCommit: "test" }));
    // Nothing here is about the embed, and a test must not reach the network to
    // find out whether a budget gate let it past. Fail it instantly instead.
    config.semanticEmbedTimeoutMs = 1;
    globalThis.fetch = (() => Promise.reject(new Error("no network in tests"))) as unknown as typeof fetch;
  });
  afterAll(() => {
    if (prevIx) setIndexes(prevIx);
    else _clearIndexes();
    config.semanticEmbedTimeoutMs = prevTimeout;
    globalThis.fetch = prevFetch;
  });

  it("429s with a retry-after once the minute's budget is spent", async () => {
    config.openrouterApiKey = "sk-test";
    config.searchSemanticRpm = 1;
    _resetSemanticBudget();
    // The route is public and unauthenticated, and each answered query spends
    // an OpenRouter call (two, once a grouped anchor is retrieved), so the
    // budget is global rather than per-caller — see search-semantic-limit.ts.
    const first = await handleSemanticSearch(new Request("http://x/api/search/semantic?q=who%20approves"));
    expect(first.status).not.toBe(429);
    const second = await handleSemanticSearch(new Request("http://x/api/search/semantic?q=who%20decides"));
    expect(second.status).toBe(429);
    expect(Number(second.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("does not charge a query that was never going to embed", async () => {
    // Too short to score, and an unconfigured deployment: neither reaches the
    // provider, so neither may burn budget a real search needs.
    config.searchSemanticRpm = 1;
    _resetSemanticBudget();
    config.openrouterApiKey = "sk-test";
    expect((await handleSemanticSearch(new Request("http://x/api/search/semantic?q=ab"))).status).toBe(200);
    config.openrouterApiKey = "";
    expect((await handleSemanticSearch(new Request("http://x/api/search/semantic?q=governance"))).status).toBe(200);
    // The one token is still there for the query that needs it.
    config.openrouterApiKey = "sk-test";
    expect((await handleSemanticSearch(new Request("http://x/api/search/semantic?q=governance"))).status).not.toBe(429);
  });
});
