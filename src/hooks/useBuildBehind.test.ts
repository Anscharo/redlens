// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, cleanup, act, waitFor } from "@testing-library/react";

const loadHealth = vi.fn();
const fetchHealthFresh = vi.fn();
vi.mock("@/lib/health", () => ({
  loadHealth: (...a: unknown[]) => loadHealth(...a),
  fetchHealthFresh: (...a: unknown[]) => fetchHealthFresh(...a),
}));

const track = vi.fn();
vi.mock("@/lib/analytics", () => ({ track: (...a: unknown[]) => track(...a) }));

function setVisible(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.resetModules();
  loadHealth.mockReset();
  fetchHealthFresh.mockReset();
  // Safe default so a test that doesn't care about health still gets a
  // resolvable promise back (loadHealth().then(...) throws on `undefined`).
  loadHealth.mockResolvedValue(null);
  fetchHealthFresh.mockResolvedValue(null);
  track.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// vitest.config.ts stubs __COMMIT_HASH__ to "test" — every scenario below is
// phrased relative to that fixed value.
describe("useBuildBehind", () => {
  it("stays false when the server's app_commit matches the running build", async () => {
    loadHealth.mockResolvedValue({ app_commit: "test" });
    const { useBuildBehind } = await import("./useBuildBehind");
    const { result } = renderHook(() => useBuildBehind());
    await waitFor(() => expect(loadHealth).toHaveBeenCalled());
    expect(result.current).toBe(false);
    expect(track).not.toHaveBeenCalled();
  });

  it("stays false when the server reports the full sha this short build hash prefixes (Railway: short client vs full RAILWAY_GIT_COMMIT_SHA)", async () => {
    // vite.config.ts bakes a SHORT sha; the server echoes the FULL 40-hex one.
    loadHealth.mockResolvedValue({ app_commit: "test" + "0123456789abcdef".repeat(2) });
    const { useBuildBehind } = await import("./useBuildBehind");
    const { result } = renderHook(() => useBuildBehind());
    await waitFor(() => expect(loadHealth).toHaveBeenCalled());
    expect(result.current).toBe(false);
    expect(track).not.toHaveBeenCalled();
  });

  it("stays false in the reverse direction too (server sha is a prefix of the build's)", async () => {
    loadHealth.mockResolvedValue({ app_commit: "tes" });
    const { useBuildBehind } = await import("./useBuildBehind");
    const { result } = renderHook(() => useBuildBehind());
    await waitFor(() => expect(loadHealth).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });

  it("flips true and tracks once when the server's app_commit differs", async () => {
    loadHealth.mockResolvedValue({ app_commit: "othersha" });
    const { useBuildBehind } = await import("./useBuildBehind");
    const { result } = renderHook(() => useBuildBehind());
    await waitFor(() => expect(result.current).toBe(true));
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("build_behind", { mine: "test", server: "othersha" });
  });

  it("ignores the server's own dev sentinel", async () => {
    loadHealth.mockResolvedValue({ app_commit: "dev" });
    const { useBuildBehind } = await import("./useBuildBehind");
    const { result } = renderHook(() => useBuildBehind());
    await waitFor(() => expect(loadHealth).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });

  it("tolerates a null health response", async () => {
    loadHealth.mockResolvedValue(null);
    const { useBuildBehind } = await import("./useBuildBehind");
    const { result } = renderHook(() => useBuildBehind());
    await waitFor(() => expect(loadHealth).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });

  it("re-checks on visibility resume after the gap, and never re-tracks a repeat difference", async () => {
    vi.useFakeTimers();
    loadHealth.mockResolvedValue({ app_commit: "othersha" });
    fetchHealthFresh.mockResolvedValue({ app_commit: "othersha2" }); // still stale, differently
    const { useBuildBehind } = await import("./useBuildBehind");
    const { result } = renderHook(() => useBuildBehind());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current).toBe(true);
    expect(track).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);
      setVisible("visible");
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(fetchHealthFresh).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(true); // stays true
    expect(track).toHaveBeenCalledTimes(1); // ref-guard: fires once per page
  });

  it("does not re-check within the 5-minute gap", async () => {
    vi.useFakeTimers();
    loadHealth.mockResolvedValue({ app_commit: "test" });
    const { useBuildBehind } = await import("./useBuildBehind");
    renderHook(() => useBuildBehind());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    act(() => setVisible("visible"));
    expect(fetchHealthFresh).not.toHaveBeenCalled();
  });

  it("ignores visibilitychange while the tab is being hidden", async () => {
    vi.useFakeTimers();
    loadHealth.mockResolvedValue({ app_commit: "test" });
    const { useBuildBehind } = await import("./useBuildBehind");
    renderHook(() => useBuildBehind());
    await act(async () => {
      vi.advanceTimersByTime(6 * 60 * 1000);
      await vi.advanceTimersByTimeAsync(0);
    });

    act(() => setVisible("hidden"));
    expect(fetchHealthFresh).not.toHaveBeenCalled();
  });

  it("removes the visibilitychange listener on unmount", async () => {
    loadHealth.mockResolvedValue({ app_commit: "test" });
    const { useBuildBehind } = await import("./useBuildBehind");
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const { unmount } = renderHook(() => useBuildBehind());
    unmount();
    expect(removeSpy).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
  });
});
