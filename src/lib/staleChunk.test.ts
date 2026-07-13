// @vitest-environment jsdom
// Deploy drift: a tab from before a deploy imports a hashed chunk that no
// longer exists. We assert the error-message detection covers every browser's
// phrasing and that the auto-reload is loop-guarded (once per cooldown).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { installStaleChunkReload, isStaleChunkError, pageReloader, reloadForStaleChunk } from "./staleChunk";

let reload: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  sessionStorage.clear();
  reload = vi.spyOn(pageReloader, "reload").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("isStaleChunkError", () => {
  it.each([
    "Failed to fetch dynamically imported module: https://x/assets/NodeContentInner-abc.js", // Chrome
    "error loading dynamically imported module: https://x/assets/a.js", // Firefox
    "Importing a module script failed.", // Safari
    "Unable to preload CSS for /assets/RadarPage-abc.css", // Vite preload helper
  ])("matches %s", (message) => {
    expect(isStaleChunkError(new TypeError(message))).toBe(true);
  });

  it("rejects unrelated errors and non-errors", () => {
    expect(isStaleChunkError(new Error("kaboom"))).toBe(false);
    expect(isStaleChunkError("Failed to fetch dynamically imported module")).toBe(false);
    expect(isStaleChunkError(undefined)).toBe(false);
  });
});

describe("reloadForStaleChunk", () => {
  it("reloads on first call, then blocks within the cooldown window", () => {
    expect(reloadForStaleChunk()).toBe(true);
    expect(reloadForStaleChunk()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads again once the cooldown has passed", () => {
    vi.useFakeTimers();
    try {
      expect(reloadForStaleChunk()).toBe(true);
      vi.setSystemTime(Date.now() + 61_000);
      expect(reloadForStaleChunk()).toBe(true);
      expect(reload).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not reload while offline", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    expect(reloadForStaleChunk()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("installStaleChunkReload", () => {
  function dispatchPreloadError(payload: unknown): Event {
    const event = new Event("vite:preloadError", { cancelable: true });
    (event as Event & { payload: unknown }).payload = payload;
    window.dispatchEvent(event);
    return event;
  }

  it("reloads and cancels the event only for stale-chunk payloads", () => {
    installStaleChunkReload();
    // A module evaluation error must surface to the boundary, not reload.
    const evalError = dispatchPreloadError(new Error("Cannot read properties of undefined"));
    expect(reload).not.toHaveBeenCalled();
    expect(evalError.defaultPrevented).toBe(false);

    const stale = dispatchPreloadError(
      new TypeError("Failed to fetch dynamically imported module: https://x/assets/a.js"),
    );
    expect(reload).toHaveBeenCalledTimes(1);
    expect(stale.defaultPrevented).toBe(true);
  });
});
