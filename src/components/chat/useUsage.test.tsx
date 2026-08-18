// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, act, waitFor, cleanup } from "@testing-library/react";
import { useUsage } from "./useUsage";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useUsage", () => {
  it("does not fetch when disabled", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderHook(() => useUsage(false));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetches usage + commons + contextWindow when enabled and populates all three", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          window: { tokens: 5, limit: 100, resetsAt: "2026-01-01", exceeded: false, windowMinutes: 60 },
          global: { used: 1, total: 10, remaining: 9 },
          contextWindowTokens: 128000,
        }),
    } as Response);
    const { result } = renderHook(() => useUsage(true));
    await waitFor(() => expect(result.current.usage?.tokens).toBe(5));
    expect(result.current.commons).toEqual({ used: 1, total: 10, remaining: 9 });
    expect(result.current.contextWindow).toBe(128000);
  });

  it("sets commons and contextWindow to null when both are absent (feature off / older server)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ window: { tokens: 5, limit: 100, resetsAt: "x", exceeded: false, windowMinutes: 60 } }),
    } as Response);
    const { result } = renderHook(() => useUsage(true));
    await waitFor(() => expect(result.current.usage?.tokens).toBe(5));
    expect(result.current.commons).toBeNull();
    expect(result.current.contextWindow).toBeNull();
  });

  it("leaves state untouched on a non-ok response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false } as Response);
    const { result } = renderHook(() => useUsage(true));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(result.current.usage).toBeNull();
  });

  it("swallows a network error without throwing", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useUsage(true));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(result.current.usage).toBeNull();
  });

  it("exposes refresh() to manually re-fetch, and setUsage to prime state (e.g. from a 429 body)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ window: { tokens: 1, limit: 10, resetsAt: "x", exceeded: false, windowMinutes: 60 } }),
    } as Response);
    const { result } = renderHook(() => useUsage(false));
    expect(result.current.usage).toBeNull();
    act(() => {
      result.current.setUsage({ tokens: 99, limit: 100, resetsAt: "x", exceeded: true, windowMinutes: 60 });
    });
    expect(result.current.usage?.tokens).toBe(99);
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.usage?.tokens).toBe(1);
  });
});
