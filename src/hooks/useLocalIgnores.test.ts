// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useLocalIgnores } from "./useLocalIgnores";
import { STORAGE_KEY } from "@/lib/curationStore";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("useLocalIgnores", () => {
  it("initializes from localStorage (empty when nothing stored)", () => {
    const { result } = renderHook(() => useLocalIgnores());
    expect(result.current.marks).toEqual([]);
  });

  it("initializes by loading existing marks from localStorage", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ uuid: "u1", reason: "dup", marked_at: "2026-01-01T00:00:00.000Z" }]),
    );
    const { result } = renderHook(() => useLocalIgnores());
    expect(result.current.marks).toHaveLength(1);
    expect(result.current.marks[0].uuid).toBe("u1");
    expect(result.current.byUuid.get("u1")?.reason).toBe("dup");
  });

  it("mark() adds an entry and persists it to localStorage", () => {
    const { result } = renderHook(() => useLocalIgnores());
    act(() => result.current.mark("u1", "not a process"));
    expect(result.current.marks).toHaveLength(1);
    expect(result.current.marks[0]).toMatchObject({ uuid: "u1", reason: "not a process" });
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored).toHaveLength(1);
    expect(stored[0].uuid).toBe("u1");
  });

  it("mark() on an existing uuid replaces (not duplicates) the entry", () => {
    const { result } = renderHook(() => useLocalIgnores());
    act(() => result.current.mark("u1", "first reason"));
    act(() => result.current.mark("u1", "second reason"));
    expect(result.current.marks).toHaveLength(1);
    expect(result.current.marks[0].reason).toBe("second reason");
  });

  it("unmark() removes the entry", () => {
    const { result } = renderHook(() => useLocalIgnores());
    act(() => result.current.mark("u1", "r"));
    act(() => result.current.mark("u2", "r2"));
    act(() => result.current.unmark("u1"));
    expect(result.current.marks.map((m) => m.uuid)).toEqual(["u2"]);
    expect(result.current.byUuid.has("u1")).toBe(false);
  });

  it("clear() removes all entries", () => {
    const { result } = renderHook(() => useLocalIgnores());
    act(() => result.current.mark("u1", "r"));
    act(() => result.current.clear());
    expect(result.current.marks).toEqual([]);
  });

  it("byUuid reflects the current marks as a Map keyed by uuid", () => {
    const { result } = renderHook(() => useLocalIgnores());
    act(() => result.current.mark("u1", "r1"));
    act(() => result.current.mark("u2", "r2"));
    expect(result.current.byUuid.get("u1")?.reason).toBe("r1");
    expect(result.current.byUuid.get("u2")?.reason).toBe("r2");
  });

  it("syncs marks when a storage event fires for the tracked key (cross-tab)", () => {
    const { result } = renderHook(() => useLocalIgnores());
    // Simulate another tab writing to localStorage directly, then firing the event.
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ uuid: "external", reason: "from another tab", marked_at: "2026-01-01T00:00:00.000Z" }]),
    );
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
    });
    expect(result.current.marks.map((m) => m.uuid)).toEqual(["external"]);
  });

  it("ignores storage events for unrelated keys", () => {
    const { result } = renderHook(() => useLocalIgnores());
    act(() => result.current.mark("u1", "r"));
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "some-other-key" }));
    });
    expect(result.current.marks.map((m) => m.uuid)).toEqual(["u1"]);
  });
});
