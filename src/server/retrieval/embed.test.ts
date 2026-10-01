// Run under `bun test`. Verifies the AbortSignal actually cancels the embed
// retry loop, so a timed-out query-time embed can't keep hammering OpenRouter
// in the background (PR #137 review — Codex P2 / Claude residual-limitation note).
import { test, expect, describe, it, afterEach } from "bun:test";
import { embedBatch, embedQueries, embedQuery, EMBED_DIM, _clearQueryEmbedCache, type EmbedDiag } from "./embed.ts";
import { config } from "../config.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  _clearQueryEmbedCache();
});

// A fetch stub that returns a valid embeddings payload and counts calls, so the
// cache tests can assert how many network round-trips actually happened.
function stubEmbedFetch() {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(JSON.stringify({ data: [{ embedding: [1, 0, 0], index: 0 }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return () => calls;
}

test("embedBatch aborts immediately on an aborted signal — no backoff retry storm", async () => {
  const prevKey = config.openrouterApiKey;
  config.openrouterApiKey = "test-key"; // otherwise it throws before the retry path
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    throw new Error("network down");
  }) as unknown as typeof fetch;

  const ac = new AbortController();
  ac.abort();
  try {
    await expect(embedBatch(["hi"], ac.signal)).rejects.toThrow();
    // One attempt, then the aborted-signal guard short-circuits: no 5x backoff.
    expect(calls).toBe(1);
  } finally {
    config.openrouterApiKey = prevKey;
  }
});

test("embedQuery caches by query — a repeat hits the cache, no second round-trip", async () => {
  const prevKey = config.openrouterApiKey;
  config.openrouterApiKey = "test-key";
  const count = stubEmbedFetch();
  try {
    const a = await embedQuery("what is a facilitator");
    const b = await embedQuery("what is a facilitator");
    expect(count()).toBe(1); // second call served from cache
    expect(b).toEqual(a);
    // A different query still goes to the network.
    await embedQuery("what is a keeper");
    expect(count()).toBe(2);
  } finally {
    config.openrouterApiKey = prevKey;
  }
});

test("embedQuery cache honors the capacity cap (LRU eviction)", async () => {
  const prevKey = config.openrouterApiKey;
  const prevCap = config.queryEmbedCacheSize;
  config.openrouterApiKey = "test-key";
  config.queryEmbedCacheSize = 2;
  const count = stubEmbedFetch();
  try {
    await embedQuery("q1"); // cache: [q1]
    await embedQuery("q2"); // cache: [q1, q2]
    await embedQuery("q3"); // evicts q1 → cache: [q2, q3]
    expect(count()).toBe(3);
    await embedQuery("q1"); // q1 was evicted → network again
    expect(count()).toBe(4);
    await embedQuery("q3"); // still cached
    expect(count()).toBe(4);
  } finally {
    config.openrouterApiKey = prevKey;
    config.queryEmbedCacheSize = prevCap;
  }
});

test("embedQuery cache is bypassed when size is 0", async () => {
  const prevKey = config.openrouterApiKey;
  const prevCap = config.queryEmbedCacheSize;
  config.openrouterApiKey = "test-key";
  config.queryEmbedCacheSize = 0;
  const count = stubEmbedFetch();
  try {
    await embedQuery("q1");
    await embedQuery("q1");
    expect(count()).toBe(2); // no caching → two round-trips
  } finally {
    config.openrouterApiKey = prevKey;
    config.queryEmbedCacheSize = prevCap;
  }
});

// ─── query instruction prefix ───────────────────────────────────────────────
// Qwen3-Embedding is asymmetric: the query carries an instruction, the document
// does not. Embedding both raw — which this codebase did until 2026-09-29 — is
// the documented 1-5% retrieval loss.

/** Capture the exact `input` array each embeddings request sent. */
function captureEmbedInput() {
  const inputs: string[][] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    inputs.push((JSON.parse(String(init.body)) as { input: string[] }).input);
    return new Response(JSON.stringify({ data: [{ embedding: [1, 0, 0], index: 0 }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return inputs;
}

test("embedQuery applies the instruction prefix; embedBatch (documents) never does", async () => {
  const prevKey = config.openrouterApiKey;
  const prevPrefix = config.embedQueryPrefix;
  config.openrouterApiKey = "test-key";
  config.embedQueryPrefix = "Instruct: task\nQuery: ";
  try {
    const inputs = captureEmbedInput();
    await embedQuery("who approves rewards");
    expect(inputs[0]).toEqual(["Instruct: task\nQuery: who approves rewards"]);

    // The document path is the raw text — collapsing the asymmetry would undo
    // the very thing the prefix exists to create.
    await embedBatch(["who approves rewards"]);
    expect(inputs[1]).toEqual(["who approves rewards"]);
  } finally {
    config.openrouterApiKey = prevKey;
    config.embedQueryPrefix = prevPrefix;
  }
});

test("an empty prefix restores the previous behaviour exactly", async () => {
  const prevKey = config.openrouterApiKey;
  const prevPrefix = config.embedQueryPrefix;
  config.openrouterApiKey = "test-key";
  config.embedQueryPrefix = "";
  try {
    const inputs = captureEmbedInput();
    await embedQuery("who approves rewards");
    expect(inputs[0]).toEqual(["who approves rewards"]);
  } finally {
    config.openrouterApiKey = prevKey;
    config.embedQueryPrefix = prevPrefix;
  }
});

test("the query cache keys on the prefix, so flipping it cannot serve a stale vector", async () => {
  const prevKey = config.openrouterApiKey;
  const prevPrefix = config.embedQueryPrefix;
  config.openrouterApiKey = "test-key";
  try {
    config.embedQueryPrefix = "Instruct: A\nQuery: ";
    const inputs = captureEmbedInput();
    await embedQuery("rewards");
    await embedQuery("rewards"); // cache hit — same prefix
    expect(inputs).toHaveLength(1);

    config.embedQueryPrefix = "Instruct: B\nQuery: ";
    await embedQuery("rewards"); // different prefix ⇒ different vector ⇒ must refetch
    expect(inputs).toHaveLength(2);
    expect(inputs[1]).toEqual(["Instruct: B\nQuery: rewards"]);
  } finally {
    config.openrouterApiKey = prevKey;
    config.embedQueryPrefix = prevPrefix;
  }
});

// ─── the cause surviving a racing timeout ───────────────────────────────────

test("embedBatch records the provider's real error across every retry", async () => {
  const prevKey = config.openrouterApiKey;
  config.openrouterApiKey = "test-key";
  try {
    globalThis.fetch = (async () =>
      new Response("invalid api key", { status: 401 })) as unknown as typeof fetch;
    const diag: EmbedDiag = {};
    const ac = new AbortController();
    ac.abort(); // stop after the first attempt, no 15s of real sleeping
    await expect(embedBatch(["q"], ac.signal, 0, diag)).rejects.toThrow(/401/);
    // This is what the UI needs: the provider's words, not the stopwatch's.
    expect(diag.lastError).toContain("embeddings 401");
  } finally {
    config.openrouterApiKey = prevKey;
  }
});

test("embedBatch sends the OpenRouter X-Title attribution header", async () => {
  const prevKey = config.openrouterApiKey;
  config.openrouterApiKey = "test-key";
  let sent: Record<string, string> = {};
  globalThis.fetch = (async (_url: any, init: any) => {
    sent = init.headers;
    return new Response(JSON.stringify({ data: [{ embedding: [1, 0, 0], index: 0 }] }), { status: 200 });
  }) as unknown as typeof fetch;
  try {
    await embedBatch(["x"]);
    expect(sent["X-Title"]).toStartWith("Sky Atlas Redline");
  } finally {
    config.openrouterApiKey = prevKey;
  }
});

test("embedQuery threads the diagnostic through to the caller", async () => {
  const prevKey = config.openrouterApiKey;
  config.openrouterApiKey = "test-key";
  try {
    globalThis.fetch = (async () =>
      new Response("rate limited", { status: 429 })) as unknown as typeof fetch;
    const diag: EmbedDiag = {};
    const ac = new AbortController();
    ac.abort();
    await expect(embedQuery("q", ac.signal, diag)).rejects.toThrow(/429/);
    expect(diag.lastError).toContain("embeddings 429");
  } finally {
    config.openrouterApiKey = prevKey;
  }
});

test("a cache hit leaves the diagnostic untouched — nothing went wrong", async () => {
  const prevKey = config.openrouterApiKey;
  config.openrouterApiKey = "test-key";
  try {
    stubEmbedFetch();
    await embedQuery("cached query");
    const diag: EmbedDiag = {};
    await embedQuery("cached query", undefined, diag);
    expect(diag.lastError).toBeUndefined();
  } finally {
    config.openrouterApiKey = prevKey;
  }
});

describe("embedQueries", () => {
  const REAL_KEY = config.openrouterApiKey;
  const prevFetch = globalThis.fetch;
  afterEach(() => {
    config.openrouterApiKey = REAL_KEY;
    globalThis.fetch = prevFetch;
    _clearQueryEmbedCache();
  });

  function stub(calls: string[][]) {
    globalThis.fetch = ((_u: string, init: { body: string }) => {
      const input = (JSON.parse(init.body) as { input: string[] }).input;
      calls.push(input);
      return Promise.resolve(
        new Response(
          JSON.stringify({ data: input.map((t, i) => ({ index: i, embedding: Array.from({ length: EMBED_DIM }, () => t.length / 100) })) }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    }) as unknown as typeof fetch;
  }

  it("sends every text in ONE request, in order", async () => {
    // The reason this exists: an embed costs a round trip, not a payload, so a
    // caller that needs two vectors must ask for them together.
    config.openrouterApiKey = "sk-test";
    const calls: string[][] = [];
    stub(calls);
    const [a, b] = await embedQueries(["who approves rewards", "approves rewards"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(2);
    expect(a).toHaveLength(EMBED_DIM);
    expect(b).toHaveLength(EMBED_DIM);
    // Order is the caller's, not the provider's — mapped by response `index`.
    expect(a).not.toEqual(b);
  });

  it("applies the query prefix to each text, like embedQuery", async () => {
    config.openrouterApiKey = "sk-test";
    const calls: string[][] = [];
    stub(calls);
    await embedQueries(["alpha", "beta"]);
    for (const sent of calls[0]!) expect(sent.startsWith(config.embedQueryPrefix)).toBe(true);
  });

  it("serves a cached text without putting it in the batch", async () => {
    config.openrouterApiKey = "sk-test";
    const calls: string[][] = [];
    stub(calls);
    const [first] = await embedQueries(["governance"]);
    const [again, fresh] = await embedQueries(["governance", "rewards"]);
    expect(again).toEqual(first);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toHaveLength(1); // only the miss
    expect(fresh).toHaveLength(EMBED_DIM);
  });

  it("fills the same cache embedQuery reads", async () => {
    config.openrouterApiKey = "sk-test";
    const calls: string[][] = [];
    stub(calls);
    const [batched] = await embedQueries(["shared text"]);
    const single = await embedQuery("shared text");
    expect(single).toEqual(batched);
    expect(calls).toHaveLength(1); // embedQuery hit the cache the batch filled
  });
});
