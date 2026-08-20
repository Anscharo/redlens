// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, cleanup, act } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { SearchState } from "./useSearch";

const track = vi.fn();
const recordVisit = vi.fn();

vi.mock("../lib/analytics", () => ({
  track: (...a: unknown[]) => track(...a),
}));
vi.mock("../lib/visitHistory", () => ({
  recordVisit: (...a: unknown[]) => recordVisit(...a),
}));

function wrapperFor(path: string) {
  const { hook } = memoryLocation({ path, record: true });
  return ({ children }: { children: React.ReactNode }) => <Router hook={hook}>{children}</Router>;
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  track.mockClear();
  recordVisit.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const doneState = (query: string, hits: number): SearchState => ({
  status: "done",
  hits: Array.from({ length: hits }, (_, i) => ({ id: String(i) })) as never,
  durationMs: 5,
  query,
});

describe("useSearchTracking", () => {
  it("fires atlas_search after the debounce once state settles to done", async () => {
    const { useSearchTracking } = await import("./useSearchTracking");
    const { rerender } = renderHook(({ state }) => useSearchTracking(state, "broad"), {
      wrapper: wrapperFor("/"),
      initialProps: { state: { status: "loading" } as SearchState },
    });
    rerender({ state: doneState("governance", 3) });
    expect(track).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(track).toHaveBeenCalledWith("atlas_search", {
      query: "governance",
      mode: "broad",
      result_count: 3,
      product: "search",
    });
    expect(recordVisit).toHaveBeenCalledWith({
      path: "/?q=governance",
      label: "governance",
      base: "",
    });
  });

  it("does not fire for empty query or a slash-prefixed query", async () => {
    const { useSearchTracking } = await import("./useSearchTracking");
    const { rerender } = renderHook(({ state }) => useSearchTracking(state, "broad"), {
      wrapper: wrapperFor("/"),
      initialProps: { state: { status: "idle" } as SearchState },
    });
    rerender({ state: doneState("", 0) });
    rerender({ state: doneState("/h", 0) });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(track).not.toHaveBeenCalled();
  });

  it("debounces rapid typing: only the final query is sent", async () => {
    const { useSearchTracking } = await import("./useSearchTracking");
    const { rerender } = renderHook(({ state }) => useSearchTracking(state, "broad"), {
      wrapper: wrapperFor("/"),
      initialProps: { state: { status: "idle" } as SearchState },
    });
    rerender({ state: doneState("g", 1) });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    rerender({ state: doneState("go", 1) });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    rerender({ state: doneState("gov", 2) });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith(
      "atlas_search",
      expect.objectContaining({ query: "gov", result_count: 2 }),
    );
  });

  it("dedupes identical query+mode within lastSent", async () => {
    const { useSearchTracking } = await import("./useSearchTracking");
    const { rerender } = renderHook(({ state }) => useSearchTracking(state, "broad"), {
      wrapper: wrapperFor("/"),
      initialProps: { state: { status: "idle" } as SearchState },
    });
    rerender({ state: doneState("governance", 3) });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(track).toHaveBeenCalledTimes(1);
    // Same query re-arrives (e.g. re-render with identical done state)
    rerender({ state: doneState("governance", 3) });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(track).toHaveBeenCalledTimes(1);
  });

  it("flushes a still-pending search on unmount", async () => {
    const { useSearchTracking } = await import("./useSearchTracking");
    const { rerender, unmount } = renderHook(({ state }) => useSearchTracking(state, "strict"), {
      wrapper: wrapperFor("/"),
      initialProps: { state: { status: "idle" } as SearchState },
    });
    rerender({ state: doneState("pending query", 1) });
    // Unmount before the 500ms debounce elapses.
    unmount();
    expect(track).toHaveBeenCalledWith(
      "atlas_search",
      expect.objectContaining({ query: "pending query", mode: "strict" }),
    );
  });
});
