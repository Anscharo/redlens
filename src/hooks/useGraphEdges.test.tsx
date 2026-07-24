// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { renderHook, cleanup, waitFor } from "@testing-library/react";

const getEdges = vi.fn();
const useDataSource = vi.fn();

vi.mock("../lib/graph", () => ({
  getEdges: (id: string) => getEdges(id),
}));
vi.mock("../lib/dataSource", () => ({
  useDataSource: () => useDataSource(),
}));

afterEach(() => cleanup());

beforeEach(() => {
  vi.resetModules();
  getEdges.mockReset();
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
