// Unit tests for the search worker's semantic leg — the decisions ("should this
// query be embedded at all?") and the fusion ("where does a meaning-only hit
// land among wording hits?"), plus the request lifecycle. No MiniSearch, no
// worker global: the leg is deliberately separable from both.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SEMANTIC_K,
  answerFromCache,
  cancelSemanticLeg,
  clearSemanticCache,
  isIdentifierQuery,
  legStatus,
  runSemanticLeg,
  semanticLegQuery,
} from "./searchSemanticLeg";
import {
  SEMANTIC_DEBOUNCE_MS,
  type SemanticSearchResponse,
} from "@/lib/searchSemantic";
import type { SearchHit, WorkerOutMessage } from "@/types";

const NO_CHAINLOG = () => false;

function hit(id: string, over: Partial<SearchHit> = {}): SearchHit {
  return {
    id,
    score: 1,
    doc_no: "A.1",
    title: id,
    titleHtml: id,
    matchReason: "title",
    type: "Core",
    depth: 2,
    parentId: null,
    snippet: "",
    ...over,
  };
}

afterEach(() => {
  cancelSemanticLeg();
  clearSemanticCache();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("isIdentifierQuery", () => {
  it("recognises the navigation shapes the lexical fast paths already answer", () => {
    expect(isIdentifierQuery("2f0e6b4a-1c3d-4e5f-8a9b-0c1d2e3f4a5b", NO_CHAINLOG)).toBe(true);
    expect(isIdentifierQuery("2f0e6b4a", NO_CHAINLOG)).toBe(true); // uuid prefix
    expect(isIdentifierQuery("A.2.7.1.1", NO_CHAINLOG)).toBe(true);
    expect(isIdentifierQuery("NR-12", NO_CHAINLOG)).toBe(true);
    expect(isIdentifierQuery("MCD_VAT", (s) => s === "MCD_VAT")).toBe(true);
    // Not a chainlog id this atlas knows → ordinary text, worth scoring.
    expect(isIdentifierQuery("MCD_VAT", NO_CHAINLOG)).toBe(false);
    expect(isIdentifierQuery("who approves rewards", NO_CHAINLOG)).toBe(false);
  });
});

describe("semanticLegQuery", () => {
  it("only the meaning lane asks — the wording lane never does", () => {
    // The whole point of the pill: a reader on the wording lane asked for a
    // wording search, and a meaning-matched row can share no word with their
    // query. Answering one with the other is a worse answer than an honest
    // empty one, and it also costs the spelling correction, which is only
    // offered for a wording search that found nothing.
    expect(semanticLegQuery("rewards", "lexical", NO_CHAINLOG)).toBeNull();
    expect(semanticLegQuery("rewards", "semantic", NO_CHAINLOG)).toEqual({ query: "rewards" });
  });

  it("stands down on an identifier, or on a query too short to score", () => {
    expect(semanticLegQuery("A.2.7.1", "semantic", NO_CHAINLOG)).toBeNull();
    expect(semanticLegQuery("ab", "semantic", NO_CHAINLOG)).toBeNull();
  });

  it("strips structured syntax and asks anyway — the reader is told it was dropped", () => {
    expect(semanticLegQuery("type:Core rewards", "semantic", NO_CHAINLOG)).toEqual({ query: "rewards" });
  });

  it("carries an in: scope through", () => {
    expect(semanticLegQuery("who approves rewards in:A.6", "semantic", NO_CHAINLOG)).toEqual({
      query: "who approves rewards",
      scope: "A.6",
    });
  });
});

describe("legStatus", () => {
  it("separates 'cannot' from 'tried and failed' from 'fine'", () => {
    expect(legStatus({ hits: [], skipped: null, available: false })).toBe("unavailable");
    expect(legStatus({ hits: [], skipped: "embed timed out", available: true })).toBe("skipped");
    expect(legStatus({ hits: [], skipped: null, available: true })).toBe("done");
  });
});

// ─── request lifecycle ──────────────────────────────────────────────────────

function collector() {
  const posted: WorkerOutMessage[] = [];
  return { posted, post: (m: WorkerOutMessage) => posted.push(m) };
}

const hydrate = (scored: SemanticSearchResponse["hits"]) =>
  scored.map((s) => hit(s.id, { semantic: true, semanticScore: s.score, matchReason: "" }));

function stubSemantic(body: SemanticSearchResponse | { status: number }, calls: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      calls.push(String(url));
      if ("status" in body) return Promise.resolve(new Response("nope", { status: body.status }));
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }),
  );
  return calls;
}

describe("runSemanticLeg", () => {
  it("waits out the debounce before spending an embed, then posts the fused set", async () => {
    vi.useFakeTimers();
    const calls = stubSemantic({ hits: [{ id: "z", score: 0.7 }], skipped: null, available: true });
    const { posted, post } = collector();
    runSemanticLeg({
      id: 4, query: { query: "who approves rewards" }, lane: "lexical",
      lexical: [], startedAt: 0, hydrate, post,
    });

    await vi.advanceTimersByTimeAsync(SEMANTIC_DEBOUNCE_MS - 1);
    expect(calls).toHaveLength(0); // typing must not buy a round-trip per keystroke
    await vi.advanceTimersByTimeAsync(2);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(`/api/search/semantic?q=who%20approves%20rewards&k=${SEMANTIC_K}`);

    await vi.waitFor(() => expect(posted).toHaveLength(1));
    const msg = posted[0] as Extract<WorkerOutMessage, { type: "results" }>;
    expect(msg.id).toBe(4);
    expect(msg.semantic).toBe("done");
    // A REPLACEMENT, not a merge: on the wording lane the leg only runs under
    // the fallback strategy, which means wording returned nothing.
    expect(msg.hits.map((h) => h.id)).toEqual(["z"]);
  });

  it("on the semantic lane posts only the scored hits, not the lexical ones", async () => {
    vi.useFakeTimers();
    stubSemantic({ hits: [{ id: "z", score: 0.7 }], skipped: null, available: true });
    const { posted, post } = collector();
    runSemanticLeg({
      id: 1, query: { query: "meaning" }, lane: "semantic",
      lexical: [], startedAt: 0, hydrate, post,
    });
    await vi.advanceTimersByTimeAsync(SEMANTIC_DEBOUNCE_MS + 1);
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    const msg = posted[0] as Extract<WorkerOutMessage, { type: "results" }>;
    expect(msg.hits.map((h) => h.id)).toEqual(["z"]);
  });

  it("keeps the lexical results and reports the reason when the request fails", async () => {
    vi.useFakeTimers();
    stubSemantic({ status: 500 });
    const { posted, post } = collector();
    runSemanticLeg({
      id: 2, query: { query: "rewards policy" }, lane: "lexical",
      lexical: [hit("a")], startedAt: 0, hydrate, post,
    });
    await vi.advanceTimersByTimeAsync(SEMANTIC_DEBOUNCE_MS + 1);
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    const msg = posted[0] as Extract<WorkerOutMessage, { type: "results" }>;
    // Replacing on-screen results with an error state would be a regression for
    // a leg that is pure enrichment.
    expect(msg.hits.map((h) => h.id)).toEqual(["a"]);
    expect(msg.semantic).toBe("skipped");
    expect(msg.semanticNote).toContain("500");
  });

  it("reports a degraded leg the server owned up to", async () => {
    vi.useFakeTimers();
    stubSemantic({ hits: [], skipped: "embed timed out after 10000ms", available: true });
    const { posted, post } = collector();
    runSemanticLeg({ id: 3, query: { query: "rewards" }, lane: "lexical", lexical: [], startedAt: 0, hydrate, post });
    await vi.advanceTimersByTimeAsync(SEMANTIC_DEBOUNCE_MS + 1);
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    const msg = posted[0] as Extract<WorkerOutMessage, { type: "results" }>;
    expect(msg.semantic).toBe("skipped");
    expect(msg.semanticNote).toBe("embed timed out after 10000ms");
  });

  it("a new leg cancels the one still waiting — one request per settled query", async () => {
    vi.useFakeTimers();
    const calls = stubSemantic({ hits: [], skipped: null, available: true });
    const { post } = collector();
    const base = { lane: "lexical" as const, lexical: [], startedAt: 0, hydrate, post };
    runSemanticLeg({ id: 1, query: { query: "gov" }, ...base });
    await vi.advanceTimersByTimeAsync(SEMANTIC_DEBOUNCE_MS - 50);
    runSemanticLeg({ id: 2, query: { query: "gover" }, ...base });
    await vi.advanceTimersByTimeAsync(SEMANTIC_DEBOUNCE_MS + 1);
    expect(calls).toEqual([`/api/search/semantic?q=gover&k=${SEMANTIC_K}`]);
  });

  it("cancelSemanticLeg stops a scheduled request outright", async () => {
    vi.useFakeTimers();
    const calls = stubSemantic({ hits: [], skipped: null, available: true });
    const { posted, post } = collector();
    runSemanticLeg({ id: 1, query: { query: "gov" }, lane: "lexical", lexical: [], startedAt: 0, hydrate, post });
    cancelSemanticLeg();
    await vi.advanceTimersByTimeAsync(SEMANTIC_DEBOUNCE_MS + 50);
    expect(calls).toHaveLength(0);
    expect(posted).toHaveLength(0);
  });
});

describe("scored-id cache", () => {
  const base = { lane: "lexical" as const, lexical: [hit("a")], startedAt: 0, hydrate };

  /** Run one leg to completion, so its response lands in the cache. */
  async function prime(query: string, body: SemanticSearchResponse, calls: string[]) {
    const { posted, post } = collector();
    stubSemantic(body, calls);
    runSemanticLeg({ id: 1, query: { query }, ...base, post });
    await vi.advanceTimersByTimeAsync(SEMANTIC_DEBOUNCE_MS + 1);
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    return posted;
  }

  it("answers a repeat query with no request and no debounce", async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    await prime("who approves rewards", { hits: [{ id: "z", score: 0.7 }], skipped: null, available: true }, calls);
    expect(calls).toHaveLength(1);

    // The lane flip: same text, different lane, and it must be final at once —
    // a reader clicking between the pills is not waiting for a round-trip.
    const { posted, post } = collector();
    const answered = answerFromCache({ id: 2, query: { query: "who approves rewards" }, ...base, lane: "semantic", lexical: [], post });
    expect(answered).toBe(true);
    expect(calls).toHaveLength(1); // nothing new on the wire
    expect(posted).toHaveLength(1);
    const msg = posted[0] as Extract<WorkerOutMessage, { type: "results" }>;
    expect(msg.id).toBe(2);
    expect(msg.semantic).toBe("done");
    // Fused for the lane it is being replayed on, not the one that filled it.
    expect(msg.hits.map((h) => h.id)).toEqual(["z"]);
  });

  it("misses on a different query", async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    await prime("rewards", { hits: [], skipped: null, available: true }, calls);
    const { posted, post } = collector();
    expect(answerFromCache({ id: 2, query: { query: "something else" }, ...base, post })).toBe(false);
    expect(posted).toHaveLength(0);
  });

  it("caches an unconfigured backend — that answer cannot change within a worker", async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    await prime("rewards", { hits: [], skipped: null, available: false }, calls);
    const { posted, post } = collector();
    expect(answerFromCache({ id: 2, query: { query: "rewards" }, ...base, post })).toBe(true);
    expect((posted[0] as Extract<WorkerOutMessage, { type: "results" }>).semantic).toBe("unavailable");
  });

  it("never caches a degraded leg — a timeout must not pin an outage to the query", async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    await prime("rewards", { hits: [], skipped: "embed timed out", available: true }, calls);
    const { posted, post } = collector();
    // A retry has to reach the network again rather than replaying the failure.
    expect(answerFromCache({ id: 2, query: { query: "rewards" }, ...base, post })).toBe(false);
    expect(posted).toHaveLength(0);
  });

  it("clearSemanticCache drops what was scored", async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    await prime("rewards", { hits: [], skipped: null, available: true }, calls);
    clearSemanticCache();
    const { post } = collector();
    expect(answerFromCache({ id: 2, query: { query: "rewards" }, ...base, post })).toBe(false);
  });

  it("replays the time the search COST, not the time the replay took", async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const posted = await prime("who approves rewards", { hits: [], skipped: null, available: true }, calls);
    const first = (posted[0] as Extract<WorkerOutMessage, { type: "results" }>).durationMs;
    expect(first).toBeGreaterThan(0); // the debounce alone puts it past zero

    const { posted: replayed, post } = collector();
    // startedAt is NOW, so an elapsed-time reading would be ~0 and the number on
    // screen would change every time the reader flipped lanes and came back.
    answerFromCache({ id: 2, query: { query: "who approves rewards" }, ...base, startedAt: performance.now(), post });
    expect((replayed[0] as Extract<WorkerOutMessage, { type: "results" }>).durationMs).toBe(first);
  });

  it("evicts least-recently-used beyond its bound", async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const body = { hits: [], skipped: null, available: true };
    for (let i = 0; i < 51; i++) await prime(`query number ${i}`, body, calls);
    const { post } = collector();
    // The first is gone; the newest is not. An unbounded map in a worker that
    // lives as long as the tab is a leak, not a cache.
    expect(answerFromCache({ id: 99, query: { query: "query number 0" }, ...base, post })).toBe(false);
    expect(answerFromCache({ id: 99, query: { query: "query number 50" }, ...base, post })).toBe(true);
  });
});
