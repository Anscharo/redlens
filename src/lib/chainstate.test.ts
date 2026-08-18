// loadChainState reads the snapshot from /api/chain-state (a Postgres row the
// atlas worker refreshes — it used to be the committed public/chain-state.json)
// and must not permanently cache a failure as empty chain-state: a transient
// blip, or a server whose worker hasn't stored a first snapshot yet (503),
// should be retried on the next call instead of silently returning empty
// on-chain values for the rest of the session.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("loadChainState", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("evicts the cache on failure so a later call re-fetches instead of reusing empty state", async () => {
    let calls = 0;
    const urls: string[] = [];
    globalThis.fetch = vi.fn(async (url: string) => {
      calls++;
      urls.push(String(url));
      return { ok: false, status: 503, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch;

    const { loadChainState } = await import("./chainstate");
    const first = await loadChainState();
    expect(first).toEqual({ block: "", values: {} });
    expect(calls).toBe(1);

    // Second call retries the fetch rather than reusing the cached empty fallback.
    const second = await loadChainState();
    expect(calls).toBe(2);
    expect(second).toEqual({ block: "", values: {} });
    expect(urls).toEqual(["/api/chain-state", "/api/chain-state"]);
  });

  it("resolves normally and caches on success", async () => {
    let calls = 0;
    const data = { block: "123", values: { addr: { fn: "1" } } };
    globalThis.fetch = vi.fn(async () => {
      calls++;
      return { ok: true, status: 200, json: async () => data } as Response;
    });

    const { loadChainState } = await import("./chainstate");
    const first = await loadChainState();
    const second = await loadChainState();
    expect(first).toEqual(data);
    expect(second).toBe(first);
    expect(calls).toBe(1);
  });
});
