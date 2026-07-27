// Run under `bun test`. Verifies the AbortSignal actually cancels the embed
// retry loop, so a timed-out query-time embed can't keep hammering OpenRouter
// in the background (PR #137 review — Codex P2 / Claude residual-limitation note).
import { test, expect, afterEach } from "bun:test";
import { embedBatch, embedQuery, _clearQueryEmbedCache } from "./embed.ts";
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
