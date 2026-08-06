import { describe, it, expect, afterEach, vi } from "vitest";
import { refreshAllowed, REFRESH_INTERVAL_MS, type BalancesResponse } from "./balances";

describe("refreshAllowed", () => {
  const now = 1_000_000_000_000;
  it("allows when never checked", () => {
    expect(refreshAllowed(null, now)).toBe(true);
  });
  it("blocks within the interval", () => {
    expect(refreshAllowed(now - 60_000, now)).toBe(false); // 1 min ago
  });
  it("allows exactly at the interval boundary and beyond", () => {
    expect(refreshAllowed(now - REFRESH_INTERVAL_MS, now)).toBe(true);
    expect(refreshAllowed(now - REFRESH_INTERVAL_MS - 1, now)).toBe(true);
  });
});

function makeResponse(overrides: Partial<BalancesResponse> = {}): BalancesResponse {
  return { lastCheckedAt: null, nextRefreshAt: null, refreshed: false, addresses: {}, ...overrides };
}

function installFetch(impl: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const spy = vi.fn(async (url: string, init?: RequestInit) => impl(url, init));
  vi.stubGlobal("fetch", spy);
  return spy;
}

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("loadBalancesCached", () => {
  it("dedupes concurrent/repeat calls to a single underlying fetch", async () => {
    const { loadBalancesCached: fresh } = await import("./balances");
    const body = makeResponse({ lastCheckedAt: "2026-01-01T00:00:00Z" });
    const fetchSpy = installFetch(() => jsonResponse(body));

    const [a, b] = await Promise.all([fresh(), fresh()]);
    expect(a).toEqual(body);
    expect(b).toEqual(body);
    expect(await fresh()).toEqual(body);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("clears the cache on failure so the next call retries, and peekCachedBalances tracks only the success", async () => {
    vi.resetModules();
    const { loadBalancesCached: fresh, peekCachedBalances: peek } = await import("./balances");
    expect(peek()).toBeNull();
    let calls = 0;
    installFetch(() => {
      calls++;
      return calls === 1 ? jsonResponse(null, false) : jsonResponse(makeResponse());
    });

    await expect(fresh()).rejects.toThrow();
    expect(peek()).toBeNull(); // the failed attempt never got recorded
    await expect(fresh()).resolves.toEqual(makeResponse());
    expect(peek()).toEqual(makeResponse());
    expect(calls).toBe(2);
  });
});

describe("requestBalancesRefresh", () => {
  it("updates the loadBalancesCached()/peekCachedBalances() cache with the POST response", async () => {
    vi.resetModules();
    const {
      loadBalancesCached: fresh,
      peekCachedBalances: peek,
      requestBalancesRefresh: refresh,
    } = await import("./balances");
    const stale = makeResponse({ lastCheckedAt: "2026-01-01T00:00:00Z" });
    const fetchSpy = installFetch(() => jsonResponse(stale));
    expect(await fresh()).toEqual(stale);

    const fresh2 = makeResponse({ lastCheckedAt: "2026-06-01T00:00:00Z", refreshed: true });
    fetchSpy.mockImplementation(async () => jsonResponse(fresh2));
    expect(await refresh()).toEqual(fresh2);
    expect(peek()).toEqual(fresh2);

    // A subsequent loadBalancesCached() call (e.g. a newly mounted address
    // tooltip) sees the refreshed data without another network request.
    expect(await fresh()).toEqual(fresh2);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("throws on a non-ok response without touching the cache", async () => {
    vi.resetModules();
    const { requestBalancesRefresh: refresh } = await import("./balances");
    installFetch(() => jsonResponse(null, false));
    await expect(refresh()).rejects.toThrow("balances refresh: 500");
  });
});
