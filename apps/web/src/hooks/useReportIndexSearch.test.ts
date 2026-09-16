// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, cleanup, act } from "@testing-library/react";
import { REPORT_INDEX_SEARCH_DEBOUNCE_MS, useReportIndexSearch } from "./useReportIndexSearch";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ hits: ["onchain-addresses"] }),
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function flushDebounce() {
  await act(async () => {
    vi.advanceTimersByTime(REPORT_INDEX_SEARCH_DEBOUNCE_MS);
  });
}

describe("useReportIndexSearch", () => {
  it("does not fetch until the debounce settles", async () => {
    renderHook(() => useReportIndexSearch("wallet"));
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(REPORT_INDEX_SEARCH_DEBOUNCE_MS - 1);
    });
    expect(fetch).not.toHaveBeenCalled();
    await flushDebounce();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "/api/reports/search?q=wallet",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("debounces rapid typing so only the final query is fetched", async () => {
    const { rerender } = renderHook(({ q }) => useReportIndexSearch(q), { initialProps: { q: "w" } });
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    rerender({ q: "wa" });
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    rerender({ q: "wallet addresses" });
    expect(fetch).not.toHaveBeenCalled();
    await flushDebounce();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "/api/reports/search?q=wallet%20addresses",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("does not refetch when only surrounding whitespace changes", async () => {
    const { rerender } = renderHook(({ q }) => useReportIndexSearch(q), { initialProps: { q: "reward" } });
    await flushDebounce();
    expect(fetch).toHaveBeenCalledTimes(1);
    rerender({ q: "reward " });
    await flushDebounce();
    rerender({ q: "  reward" });
    await flushDebounce();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("skips the network for a blank query", () => {
    renderHook(() => useReportIndexSearch("   "));
    expect(fetch).not.toHaveBeenCalled();
  });
});
