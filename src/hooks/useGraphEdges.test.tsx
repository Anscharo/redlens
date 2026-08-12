// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { renderHook, cleanup, waitFor } from "@testing-library/react";

const getEdges = vi.fn();
const useDataSource = vi.fn();
const trackFn = vi.fn();

vi.mock("../lib/graph", () => ({
  getEdges: (id: string) => getEdges(id),
}));
vi.mock("../lib/dataSource", () => ({
  useDataSource: () => useDataSource(),
}));
// Mocked so a developer's VITE_POSTHOG_KEY (.env.local leaks into vitest) can't
// make the hook fire a live capture from jsdom.
vi.mock("../lib/analytics", () => ({
  track: (event: string, props?: Record<string, unknown>) => trackFn(event, props),
}));

afterEach(() => cleanup());

beforeEach(() => {
  vi.resetModules();
  getEdges.mockReset();
  trackFn.mockReset();
  useDataSource.mockReset();
  useDataSource.mockReturnValue({ base: "/api/atlas/sha1/", preview: null });
});

describe("useGraphEdges", () => {
  it("returns empty edges immediately, then the resolved result", async () => {
    const edges = { outbound: [{ id: "e1" }], inbound: [] };
    getEdges.mockResolvedValue(edges);
    const { useGraphEdges } = await import("./useGraphEdges");
    const { result } = renderHook(() => useGraphEdges("node-1"));
    expect(result.current).toEqual({ outbound: [], inbound: [] });
    await waitFor(() => expect(result.current).toEqual(edges));
    expect(getEdges).toHaveBeenCalledWith("node-1");
  });

  it("skips the fetch and stays empty when id is falsy", async () => {
    const { useGraphEdges } = await import("./useGraphEdges");
    const { result } = renderHook(() => useGraphEdges(""));
    expect(result.current).toEqual({ outbound: [], inbound: [] });
    expect(getEdges).not.toHaveBeenCalled();
  });

  it("skips the fetch and stays empty in preview mode", async () => {
    useDataSource.mockReturnValue({ base: "/api/preview/sha1/", preview: { id: "p1", sha: "sha1" } });
    const { useGraphEdges } = await import("./useGraphEdges");
    const { result } = renderHook(() => useGraphEdges("node-1"));
    expect(result.current).toEqual({ outbound: [], inbound: [] });
    expect(getEdges).not.toHaveBeenCalled();
  });

  it("resets to empty and reverts to empty on getEdges failure, logging a warning", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    getEdges.mockRejectedValue(new Error("boom"));
    const { useGraphEdges } = await import("./useGraphEdges");
    const { result } = renderHook(() => useGraphEdges("node-1"));
    await waitFor(() => expect(warnSpy).toHaveBeenCalled());
    expect(result.current).toEqual({ outbound: [], inbound: [] });
    warnSpy.mockRestore();
  });

  // A worker init failure terminates the graph worker (failWorker), so the next
  // getEdges call respawns it — one retry recovers the transient class instead
  // of leaving "cited by" silently empty for the rest of the session.
  it("retries once after a failure and applies the retried result", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const edges = { outbound: [{ id: "e1" }], inbound: [] };
    getEdges.mockRejectedValueOnce(new Error("worker died"));
    getEdges.mockResolvedValue(edges);
    const { useGraphEdges } = await import("./useGraphEdges");
    const { result } = renderHook(() => useGraphEdges("node-1"));
    await waitFor(() => expect(result.current).toEqual(edges));
    expect(getEdges).toHaveBeenCalledTimes(2);
    expect(trackFn).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("gives up after the retry also fails, staying empty and tracking the failure once", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    getEdges.mockRejectedValue(new Error("worker died"));
    const { useGraphEdges } = await import("./useGraphEdges");
    const { result } = renderHook(() => useGraphEdges("node-1"));
    await waitFor(() => expect(trackFn).toHaveBeenCalledTimes(1));
    expect(getEdges).toHaveBeenCalledTimes(2);
    expect(trackFn).toHaveBeenCalledWith(
      "graph_worker_failed",
      expect.objectContaining({ node_id: "node-1", error: "worker died" }),
    );
    expect(result.current).toEqual({ outbound: [], inbound: [] });
    warnSpy.mockRestore();
  });

  it("does not retry after unmount during the retry delay", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    getEdges.mockRejectedValue(new Error("worker died"));
    const { useGraphEdges } = await import("./useGraphEdges");
    const { unmount } = renderHook(() => useGraphEdges("node-1"));
    await waitFor(() =>
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("retrying"), expect.anything()),
    );
    unmount();
    await new Promise((r) => setTimeout(r, 500));
    expect(getEdges).toHaveBeenCalledTimes(1);
    expect(trackFn).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("re-fetches and resets to empty when id changes", async () => {
    const edgesA = { outbound: [{ id: "a" }], inbound: [] };
    const edgesB = { outbound: [{ id: "b" }], inbound: [] };
    getEdges.mockImplementation((id: string) => Promise.resolve(id === "node-a" ? edgesA : edgesB));
    const { useGraphEdges } = await import("./useGraphEdges");
    const { result, rerender } = renderHook(({ id }) => useGraphEdges(id), {
      initialProps: { id: "node-a" },
    });
    await waitFor(() => expect(result.current).toEqual(edgesA));
    rerender({ id: "node-b" });
    await waitFor(() => expect(result.current).toEqual(edgesB));
  });

  it("does not apply a stale result after unmount", async () => {
    let resolve: (v: unknown) => void = () => {};
    getEdges.mockReturnValue(new Promise((r) => (resolve = r)));
    const { useGraphEdges } = await import("./useGraphEdges");
    const { result, unmount } = renderHook(() => useGraphEdges("node-1"));
    unmount();
    resolve({ outbound: [{ id: "late" }], inbound: [] });
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toEqual({ outbound: [], inbound: [] });
  });
});
