// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { mergeRecent, type RecentEntry } from "./recentSearches";
import type * as RecentSearchesModule from "./recentSearches";
import type { SearchState } from "../hooks/useSearch";
import type { SearchHit } from "../types";

const KEY = "redline-sky-atlas:recent-searches";
const EVENT = "redline-recent-searches-change";

// The module caches its snapshot at import time (see recentSearches.ts), so
// tests that seed sessionStorage before import — or that need an isolated
// event-listener count — need a fresh module instance each time.
async function freshModule(): Promise<typeof RecentSearchesModule> {
  vi.resetModules();
  return import("./recentSearches");
}

function hits(n: number): SearchHit[] {
  return Array.from({ length: n }, () => ({}) as SearchHit);
}

function doneState(query: string, n: number): SearchState {
  return { status: "done", hits: hits(n), durationMs: 1, query };
}

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// mergeRecent is the policy that decides what counts as a distinct "recent
// query": exact dedupe, newest first, capped at 10. Timestamp and result count
// are passed in so the policy stays pure/deterministic.

const qs = (list: RecentEntry[]) => list.map((e) => e.q);

describe("mergeRecent", () => {
  it("prepends a brand-new query with its timestamp and count", () => {
    const out = mergeRecent([{ q: "governance", t: 1, n: 5 }], "vat", 2, 3);
    expect(out).toEqual([
      { q: "vat", t: 2, n: 3 },
      { q: "governance", t: 1, n: 5 },
    ]);
  });

  it("ignores a blank / whitespace-only query", () => {
    const list = [{ q: "vat", t: 1, n: 4 }];
    expect(mergeRecent(list, "   ", 2, 3)).toBe(list);
  });

  it("trims the stored query and keeps its count", () => {
    expect(mergeRecent([], "  delegate  ", 1, 7)[0]).toEqual({ q: "delegate", t: 1, n: 7 });
  });

  it("moves an exact duplicate to the front with a fresh timestamp and count", () => {
    const list = [{ q: "a", t: 1, n: 1 }, { q: "b", t: 2, n: 2 }, { q: "c", t: 3, n: 3 }];
    expect(mergeRecent(list, "c", 9, 42)).toEqual([
      { q: "c", t: 9, n: 42 },
      { q: "a", t: 1, n: 1 },
      { q: "b", t: 2, n: 2 },
    ]);
  });

  it("keeps a prefix and its extension as distinct entries (no collapse)", () => {
    // Regression: searching "amatsu" then "amat" must keep both — "amat" being a
    // prefix of "amatsu" used to silently delete "amatsu".
    let list = mergeRecent([], "amatsu", 1, 2);
    list = mergeRecent(list, "amat", 2, 9);
    expect(qs(list)).toEqual(["amat", "amatsu"]);
  });

  it("keeps genuinely different queries", () => {
    let list: RecentEntry[] = [];
    let t = 0;
    for (const q of ["vat", "jug", "pot"]) list = mergeRecent(list, q, ++t, 1);
    expect(qs(list)).toEqual(["pot", "jug", "vat"]);
  });

  it("caps the list at 10 entries", () => {
    let list: RecentEntry[] = [];
    for (let i = 0; i < 15; i++) list = mergeRecent(list, `q${i}`, i, i);
    expect(list).toHaveLength(10);
    expect(list[0].q).toBe("q14");
  });
});

describe("recordRecent / clearRecent", () => {
  it("persists a query to sessionStorage and fires the same-tab change event", async () => {
    const mod = await freshModule();
    const handler = vi.fn();
    window.addEventListener(EVENT, handler);
    mod.recordRecent("governance", 5);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sessionStorage.getItem(KEY)!)).toEqual([
      { q: "governance", t: expect.any(Number), n: 5 },
    ]);
    window.removeEventListener(EVENT, handler);
  });

  it("is a no-op for a blank/whitespace-only query — no write, no event", async () => {
    const mod = await freshModule();
    const handler = vi.fn();
    window.addEventListener(EVENT, handler);
    mod.recordRecent("   ", 3);
    expect(handler).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(KEY)).toBeNull();
    window.removeEventListener(EVENT, handler);
  });

  it("clearRecent empties the stored list and notifies", async () => {
    const mod = await freshModule();
    mod.recordRecent("vat", 1);
    const handler = vi.fn();
    window.addEventListener(EVENT, handler);
    mod.clearRecent();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sessionStorage.getItem(KEY)!)).toEqual([]);
    window.removeEventListener(EVENT, handler);
  });
});

describe("refreshRecent", () => {
  it("does nothing when the visible query list hasn't changed", async () => {
    const mod = await freshModule();
    mod.recordRecent("vat", 1);
    const handler = vi.fn();
    window.addEventListener(EVENT, handler);
    mod.refreshRecent();
    expect(handler).not.toHaveBeenCalled();
    window.removeEventListener(EVENT, handler);
  });

  it("republishes once TTL pruning drops an entry from the visible list", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const mod = await freshModule();
    mod.recordRecent("vat", 1);
    vi.setSystemTime(61 * 60 * 1000); // just past the 1h TTL
    const handler = vi.fn();
    window.addEventListener(EVENT, handler);
    mod.refreshRecent();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sessionStorage.getItem(KEY)!)).toEqual([]);
    window.removeEventListener(EVENT, handler);
  });
});

describe("read (via useRecentSearches / import-time snapshot)", () => {
  it("tolerates malformed JSON, returning an empty list", async () => {
    sessionStorage.setItem(KEY, "{not valid json");
    const mod = await freshModule();
    const { result } = renderHook(() => mod.useRecentSearches());
    expect(result.current).toEqual([]);
  });

  it("discards a non-array payload", async () => {
    sessionStorage.setItem(KEY, JSON.stringify({ foo: "bar" }));
    const mod = await freshModule();
    const { result } = renderHook(() => mod.useRecentSearches());
    expect(result.current).toEqual([]);
  });

  it("filters malformed/expired entries, keeps valid ones (n is optional on legacy rows)", async () => {
    const now = Date.now();
    const raw = [
      { q: "fresh", t: now, n: 3 },
      { q: "legacy-no-count", t: now },
      { q: "stale", t: now - 2 * 60 * 60 * 1000 }, // 2h old — past the 1h TTL
      { q: 123, t: now }, // wrong type — dropped
      "not-an-object", // dropped
    ];
    sessionStorage.setItem(KEY, JSON.stringify(raw));
    const mod = await freshModule();
    const { result } = renderHook(() => mod.useRecentSearches());
    expect(result.current).toEqual([
      { q: "fresh", n: 3 },
      { q: "legacy-no-count", n: undefined },
    ]);
  });

  it("caps the read-back list at 10 even if more were persisted directly", async () => {
    const now = Date.now();
    const raw = Array.from({ length: 15 }, (_, i) => ({ q: `q${i}`, t: now, n: i }));
    sessionStorage.setItem(KEY, JSON.stringify(raw));
    const mod = await freshModule();
    const { result } = renderHook(() => mod.useRecentSearches());
    expect(result.current).toHaveLength(10);
  });
});

describe("useRecentSearches", () => {
  it("re-renders with the new entry once recordRecent commits (same-tab event)", async () => {
    const mod = await freshModule();
    const { result } = renderHook(() => mod.useRecentSearches());
    expect(result.current).toEqual([]);
    act(() => mod.recordRecent("vat", 2));
    expect(result.current).toEqual([{ q: "vat", n: 2 }]);
  });

  it("ignores a storage-shaped event dispatched under a different name (never happens in practice, but the handler is keyed on EVENT only)", async () => {
    const mod = await freshModule();
    const { result } = renderHook(() => mod.useRecentSearches());
    act(() => window.dispatchEvent(new Event("some-other-event")));
    expect(result.current).toEqual([]);
  });
});

describe("useRecordRecentSearch", () => {
  it("records after the 500ms debounce settles, once the search is done with hits", async () => {
    vi.useFakeTimers();
    const mod = await freshModule();
    renderHook(() => mod.useRecordRecentSearch(doneState("governance", 4), "governance"));
    act(() => vi.advanceTimersByTime(500));
    expect(JSON.parse(sessionStorage.getItem(KEY)!)).toEqual([
      { q: "governance", t: expect.any(Number), n: 4 },
    ]);
  });

  it("does not record a zero-hit result", async () => {
    vi.useFakeTimers();
    const mod = await freshModule();
    renderHook(() => mod.useRecordRecentSearch(doneState("x", 0), "x"));
    act(() => vi.advanceTimersByTime(500));
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("does not record a slash-command query", async () => {
    vi.useFakeTimers();
    const mod = await freshModule();
    renderHook(() => mod.useRecordRecentSearch(doneState("/h", 3), "/h"));
    act(() => vi.advanceTimersByTime(500));
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("does not record while still loading/searching (only 'done' fires)", async () => {
    vi.useFakeTimers();
    const mod = await freshModule();
    renderHook(() => mod.useRecordRecentSearch({ status: "searching" }, "governance"));
    act(() => vi.advanceTimersByTime(500));
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("resets the debounce timer when the state changes before it settles", async () => {
    vi.useFakeTimers();
    const mod = await freshModule();
    const { rerender } = renderHook(
      ({ state, raw }: { state: SearchState; raw: string }) => mod.useRecordRecentSearch(state, raw),
      { initialProps: { state: { status: "loading" } as SearchState, raw: "gov" } },
    );
    rerender({ state: doneState("gov", 2), raw: "gov" });
    act(() => vi.advanceTimersByTime(200));
    rerender({ state: doneState("governance", 5), raw: "governance" });
    act(() => vi.advanceTimersByTime(499));
    expect(sessionStorage.getItem(KEY)).toBeNull(); // still short of the reset 500ms
    act(() => vi.advanceTimersByTime(1));
    expect(JSON.parse(sessionStorage.getItem(KEY)!)).toEqual([
      { q: "governance", t: expect.any(Number), n: 5 },
    ]);
  });

  it("clears its pending timer on unmount, never recording", async () => {
    vi.useFakeTimers();
    const mod = await freshModule();
    const { unmount } = renderHook(() => mod.useRecordRecentSearch(doneState("gov", 2), "gov"));
    unmount();
    act(() => vi.advanceTimersByTime(500));
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });
});
