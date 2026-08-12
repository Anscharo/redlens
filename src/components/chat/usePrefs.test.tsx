// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { usePrefs as UsePrefsType } from "./usePrefs";

// usePrefs.ts caches its parsed localStorage value in module-level state (read
// once at import time, updated only via its own setPref/event handlers) so that
// useSyncExternalStore gets a stable snapshot reference. That means tests that
// mutate localStorage directly need a FRESH module per test (via resetModules +
// dynamic import) rather than relying on the cached snapshot noticing the change.
async function freshUsePrefs(): Promise<typeof UsePrefsType> {
  vi.resetModules();
  const mod = await import("./usePrefs");
  return mod.usePrefs;
}

beforeEach(() => {
  localStorage.clear();
  document.body.className = "";
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.body.className = "";
  vi.restoreAllMocks();
});

describe("usePrefs", () => {
  it("defaults to traces off and reduceMotion off when nothing is stored", async () => {
    const usePrefs = await freshUsePrefs();
    const { result } = renderHook(() => usePrefs());
    expect(result.current.prefs).toEqual({ traces: false, reduceMotion: false, delivery: null });
  });

  it("reads a previously stored current-schema preference, filling in defaults", async () => {
    localStorage.setItem("rlc-prefs", JSON.stringify({ traces: true, v: 2 }));
    const usePrefs = await freshUsePrefs();
    const { result } = renderHook(() => usePrefs());
    expect(result.current.prefs).toEqual({ traces: true, reduceMotion: false, delivery: null });
  });

  it("ignores a pre-migration (unversioned) stored preference, so a restored switch starts from its default", async () => {
    localStorage.setItem("rlc-prefs", JSON.stringify({ traces: true, reduceMotion: true }));
    const usePrefs = await freshUsePrefs();
    const { result } = renderHook(() => usePrefs());
    expect(result.current.prefs).toEqual({ traces: false, reduceMotion: false, delivery: null });
  });

  it("tolerates corrupt JSON in storage by falling back to defaults", async () => {
    localStorage.setItem("rlc-prefs", "{not json");
    const usePrefs = await freshUsePrefs();
    const { result } = renderHook(() => usePrefs());
    expect(result.current.prefs).toEqual({ traces: false, reduceMotion: false, delivery: null });
  });

  it("setPref persists to localStorage and updates the returned prefs", async () => {
    const usePrefs = await freshUsePrefs();
    const { result } = renderHook(() => usePrefs());
    act(() => result.current.setPref("traces", true));
    expect(result.current.prefs.traces).toBe(true);
    expect(JSON.parse(localStorage.getItem("rlc-prefs")!)).toEqual({
      traces: true,
      reduceMotion: false,
      delivery: null,
      v: 2,
    });
  });

  it("toggles the rlc-nomotion body class with reduceMotion", async () => {
    const usePrefs = await freshUsePrefs();
    const { result } = renderHook(() => usePrefs());
    expect(document.body.classList.contains("rlc-nomotion")).toBe(false);
    act(() => result.current.setPref("reduceMotion", true));
    expect(document.body.classList.contains("rlc-nomotion")).toBe(true);
    act(() => result.current.setPref("reduceMotion", false));
    expect(document.body.classList.contains("rlc-nomotion")).toBe(false);
  });

  it("syncs a preference change to other subscribed hook instances via the custom event", async () => {
    const usePrefs = await freshUsePrefs();
    const a = renderHook(() => usePrefs());
    const b = renderHook(() => usePrefs());
    act(() => a.result.current.setPref("traces", true));
    expect(b.result.current.prefs.traces).toBe(true);
  });

  it("syncs across a cross-tab storage event", async () => {
    const usePrefs = await freshUsePrefs();
    const { result } = renderHook(() => usePrefs());
    localStorage.setItem("rlc-prefs", JSON.stringify({ traces: true, reduceMotion: true, v: 2 }));
    act(() => {
      window.dispatchEvent(new Event("storage"));
    });
    expect(result.current.prefs).toEqual({ traces: true, reduceMotion: true, delivery: null });
  });

  it("defaults delivery to null (follow server default)", async () => {
    const usePrefs = await freshUsePrefs();
    const { result } = renderHook(() => usePrefs());
    expect(result.current.prefs.delivery).toBeNull();
  });

  it("setPref('delivery', 'staged') persists and round-trips through a fresh module load", async () => {
    const usePrefs = await freshUsePrefs();
    const { result } = renderHook(() => usePrefs());
    act(() => result.current.setPref("delivery", "staged"));
    expect(result.current.prefs.delivery).toBe("staged");

    const reloaded = await freshUsePrefs();
    const { result: result2 } = renderHook(() => reloaded());
    expect(result2.current.prefs.delivery).toBe("staged");
  });

  it("setPref('delivery', null) clears back to following the server default", async () => {
    const usePrefs = await freshUsePrefs();
    const { result } = renderHook(() => usePrefs());
    act(() => result.current.setPref("delivery", "staged"));
    act(() => result.current.setPref("delivery", null));
    expect(result.current.prefs.delivery).toBeNull();
  });
});
