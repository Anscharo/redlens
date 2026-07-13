// @vitest-environment jsdom
// Deploy drift: a tab from before a deploy imports a hashed chunk that no
// longer exists. We assert the error-message detection covers every browser's
// phrasing — the ErrorBoundary fallbacks use it to show the refresh prompt.

import { describe, it, expect } from "vitest";
import { isStaleChunkError } from "./staleChunk";

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
