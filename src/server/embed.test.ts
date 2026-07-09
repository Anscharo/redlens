// Run under `bun test`. Verifies the AbortSignal actually cancels the embed
// retry loop, so a timed-out query-time embed can't keep hammering OpenRouter
// in the background (PR #137 review — Codex P2 / Claude residual-limitation note).
import { test, expect, afterEach } from "bun:test";
import { embedBatch } from "./embed.ts";
import { config } from "./config.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

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
