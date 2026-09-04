// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressBalances, BalancesResponse } from "@/lib/balances";
import { resetSharedBalances, useSharedBalances } from "./sharedBalances";

const { loadBalancesCached, peekCachedBalances } = vi.hoisted(() => ({
  loadBalancesCached: vi.fn(),
  peekCachedBalances: vi.fn(() => null),
}));

vi.mock("@/lib/balances", () => ({
  loadBalancesCached: (...args: unknown[]) => loadBalancesCached(...args),
  peekCachedBalances: (...args: unknown[]) => peekCachedBalances(...args),
}));

const ADDR = "0xabc";

function response(addresses: Record<string, AddressBalances> = {}): BalancesResponse {
  return { lastCheckedAt: null, nextRefreshAt: null, refreshed: false, addresses };
}

function eth(raw: string): AddressBalances {
  return {
    chain: "ethereum",
    checkedAt: null,
    hasCode: null,
    balances: { ETH: { raw, decimals: 18 } },
  };
}

describe("useSharedBalances", () => {
  beforeEach(() => {
    loadBalancesCached.mockReset();
    peekCachedBalances.mockReset();
    peekCachedBalances.mockReturnValue(null);
    resetSharedBalances();
  });

  afterEach(() => {
    resetSharedBalances();
  });

  it("does not fetch until an eager mount", async () => {
    loadBalancesCached.mockResolvedValue(response({ [`${ADDR}|ethereum`]: eth("1") }));
    const lazy = renderHook(() => useSharedBalances(false));
    expect(loadBalancesCached).not.toHaveBeenCalled();
    expect(lazy.result.current.addresses).toEqual({});
    expect(lazy.result.current.ready).toBe(false);

    const eager = renderHook(() => useSharedBalances(true));
    await waitFor(() => expect(eager.result.current.ready).toBe(true));
    expect(loadBalancesCached).toHaveBeenCalledTimes(1);
    expect(lazy.result.current.addresses[`${ADDR}|ethereum`]?.balances.ETH.raw).toBe("1");
    lazy.unmount();
    eager.unmount();
  });

  it("fetches once when a teaser mounts, then shares the result", async () => {
    loadBalancesCached.mockResolvedValue(response({ [`${ADDR}|ethereum`]: eth("1") }));
    const a = renderHook(() => useSharedBalances(true));
    const b = renderHook(() => useSharedBalances(true));
    await waitFor(() => {
      expect(a.result.current.ready).toBe(true);
      expect(b.result.current.ready).toBe(true);
    });
    expect(loadBalancesCached).toHaveBeenCalledTimes(1);
    expect(a.result.current.addresses[`${ADDR}|ethereum`]?.balances.ETH.raw).toBe("1");
    expect(b.result.current.addresses[`${ADDR}|ethereum`]?.balances.ETH.raw).toBe("1");
    a.unmount();
    b.unmount();
  });

  it("seeds from the session cache without fetching", () => {
    peekCachedBalances.mockReturnValue(response({ [`${ADDR}|ethereum`]: eth("2") }));
    resetSharedBalances();
    const { result, unmount } = renderHook(() => useSharedBalances(true));
    expect(result.current.ready).toBe(true);
    expect(result.current.addresses[`${ADDR}|ethereum`]?.balances.ETH.raw).toBe("2");
    expect(loadBalancesCached).not.toHaveBeenCalled();
    unmount();
  });

  it("stays empty and ready when the fetch fails", async () => {
    loadBalancesCached.mockRejectedValue(new Error("offline"));
    const { result, unmount } = renderHook(() => useSharedBalances(true));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.addresses).toEqual({});
    unmount();
  });

  it("treats a sync-throwing loader as empty-and-ready", () => {
    loadBalancesCached.mockImplementation(() => {
      throw new Error("boom");
    });
    const { result, unmount } = renderHook(() => useSharedBalances(true));
    expect(result.current.ready).toBe(true);
    expect(result.current.addresses).toEqual({});
    unmount();
  });

  it("treats a non-promise loader as empty-and-ready", () => {
    loadBalancesCached.mockReturnValue(undefined);
    const { result, unmount } = renderHook(() => useSharedBalances(true));
    expect(result.current.ready).toBe(true);
    expect(result.current.addresses).toEqual({});
    unmount();
  });
});
