// Deliberately no jsdom environment pragma on this file — it runs under the
// default node environment, where `typeof window === "undefined"` for real
// (see docs.test.ts for the same pattern). Covers atlasBase.ts's SSR /
// pre-injection fallback branches, which the jsdom-based atlasBase.test.ts
// cannot reach. (Do not write out the literal pragma comment in this note —
// vitest's environment scanner matches it anywhere in the file, not just as
// a directive on line 1.)
import { describe, it, expect, vi, beforeEach } from "vitest";

const track = vi.fn();
vi.mock("./analytics", () => ({ track: (...a: unknown[]) => track(...a) }));

beforeEach(() => {
  vi.resetModules();
  track.mockClear();
});

describe("atlasBase without a window", () => {
  it("liveAtlasBase falls back to BASE_URL", async () => {
    const { liveAtlasBase } = await import("./atlasBase");
    expect(liveAtlasBase()).toBe(import.meta.env.BASE_URL);
  });

  it("liveAtlasSha returns null", async () => {
    const { liveAtlasSha } = await import("./atlasBase");
    expect(liveAtlasSha()).toBeNull();
  });

  it("handledStale returns true without scheduling anything to track", async () => {
    const { handledStale } = await import("./atlasBase");
    const { StaleAtlasError } = await import("@/lib/verify");
    expect(handledStale(new StaleAtlasError("/api/atlas/deadbeef/docs.json"))).toBe(true);
    expect(track).not.toHaveBeenCalled();
  });

  it("handledStale returns false for an unrelated error", async () => {
    const { handledStale } = await import("./atlasBase");
    expect(handledStale(new Error("boom"))).toBe(false);
  });

  it("handledStaleMessage returns true without scheduling anything to track", async () => {
    const { handledStaleMessage } = await import("./atlasBase");
    expect(handledStaleMessage("StaleAtlasError: /api/atlas/deadbeef/docs.json")).toBe(true);
    expect(track).not.toHaveBeenCalled();
  });

  it("handledStaleMessage returns false for an unrelated message", async () => {
    const { handledStaleMessage } = await import("./atlasBase");
    expect(handledStaleMessage("some other error")).toBe(false);
  });
});
