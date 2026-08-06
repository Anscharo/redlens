import { describe, it, expect, vi, afterEach } from "vitest";
import { refreshAllowed, REFRESH_INTERVAL_MS, loadBalances, requestBalancesRefresh } from "./balances";

afterEach(() => {
  vi.unstubAllGlobals();
});

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

describe("loadBalances", () => {
  it("GETs /api/balances and returns the parsed response", async () => {
    const body = { lastCheckedAt: null, nextRefreshAt: null, refreshed: false, addresses: {} };
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))));
    await expect(loadBalances()).resolves.toEqual(body);
  });
});

describe("requestBalancesRefresh", () => {
  it("POSTs /api/balances and returns the parsed response", async () => {
    const body = { lastCheckedAt: "t", nextRefreshAt: "t2", refreshed: true, addresses: {} };
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(requestBalancesRefresh()).resolves.toEqual(body);
    expect(fetchMock).toHaveBeenCalledWith("/api/balances", { method: "POST" });
  });

  it("throws with the response status on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("", { status: 503 }))));
    await expect(requestBalancesRefresh()).rejects.toThrow(/503/);
  });
});
