// @vitest-environment jsdom
// getConstellationInit now REJECTS on a worker init failure (deep review Exec
// #4). This consumer must surface that as `initError` — not swallow it into a
// permanent null (forever "loading constellations") or leak an unhandled
// rejection. Query/cluster already had .catch; this covers the init path.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, waitFor, cleanup, act } from "@testing-library/react";

const { getConstellationInit, constellationQuery, constellationCluster } = vi.hoisted(() => ({
  getConstellationInit: vi.fn(() => new Promise(() => {})),
  constellationQuery: vi.fn(() => new Promise(() => {})),
  constellationCluster: vi.fn(() => new Promise(() => {})),
}));
vi.mock("../lib/graph", () => ({
  getConstellationInit,
  constellationQuery,
  constellationCluster,
}));

import { useConstellationsWorker } from "./useConstellationsWorker";

// Each test sets its own mockImplementation; no mockReset (a reset in beforeEach
// spuriously trips vitest's unhandled-rejection guard even though the hook's
// two-arg .then handles the rejection). cleanup() unmounts between tests.
afterEach(() => cleanup());

describe("useConstellationsWorker init failure", () => {
  it("exposes initError when getConstellationInit rejects", async () => {
    getConstellationInit.mockImplementation(() => Promise.reject(new Error("relations.json 500")));
    const { result } = renderHook(() => useConstellationsWorker("", null));

    await waitFor(() => expect(result.current.initError).toBeInstanceOf(Error));
    expect(result.current.initError?.message).toMatch(/500/);
    expect(result.current.init).toBeNull();
  });

  it("exposes init and no error on success", async () => {
    getConstellationInit.mockImplementation(() => Promise.resolve({ entities: [], entityEdges: [] }));
    const { result } = renderHook(() => useConstellationsWorker("", null));

    await waitFor(() => expect(result.current.init).not.toBeNull());
    expect(result.current.initError).toBeNull();
  });
});

describe("useConstellationsWorker query effect (debounced)", () => {
  beforeEach(() => {
    getConstellationInit.mockImplementation(() => new Promise(() => {}));
    constellationQuery.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("runs constellationQuery after the 150ms debounce and stores neighborIds/topId", async () => {
    constellationQuery.mockResolvedValue({ neighborIds: ["a", "b"], topId: "a" });
    const { result } = renderHook(() => useConstellationsWorker("governance", null));
    // Not called before the debounce elapses.
    expect(constellationQuery).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(150);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(constellationQuery).toHaveBeenCalledWith(expect.any(Number), "governance");
    expect(result.current.neighborIds).toEqual(new Set(["a", "b"]));
    expect(result.current.topId).toBe("a");
  });

  it("clears neighborIds/topId for a blank/whitespace query without querying", () => {
    const { result } = renderHook(() => useConstellationsWorker("   ", null));
    act(() => vi.advanceTimersByTime(300));
    expect(constellationQuery).not.toHaveBeenCalled();
    expect(result.current.neighborIds).toBeNull();
    expect(result.current.topId).toBeNull();
  });

  it("cancels a pending debounced query when the query changes before it fires", () => {
    constellationQuery.mockResolvedValue({ neighborIds: [], topId: null });
    const { rerender } = renderHook(({ q }) => useConstellationsWorker(q, null), {
      initialProps: { q: "first" },
    });
    act(() => vi.advanceTimersByTime(100)); // not yet at 150
    rerender({ q: "second" });
    act(() => vi.advanceTimersByTime(150));
    // Only the second query's timer survives.
    expect(constellationQuery).toHaveBeenCalledTimes(1);
    expect(constellationQuery).toHaveBeenCalledWith(expect.any(Number), "second");
  });
});

describe("useConstellationsWorker cluster effect", () => {
  beforeEach(() => {
    getConstellationInit.mockImplementation(() => new Promise(() => {}));
    constellationCluster.mockReset();
  });

  it("loads clusterIds when a focusAgentId is set", async () => {
    constellationCluster.mockResolvedValue(["x", "y"]);
    const { result } = renderHook(() => useConstellationsWorker("", "agent-1"));
    await waitFor(() => expect(result.current.clusterIds).toEqual(new Set(["x", "y"])));
    expect(constellationCluster).toHaveBeenCalledWith("agent-1");
  });

  it("clears clusterIds when focusAgentId becomes null", async () => {
    constellationCluster.mockResolvedValue(["x"]);
    const { result, rerender } = renderHook(({ f }) => useConstellationsWorker("", f), {
      initialProps: { f: "agent-1" as string | null },
    });
    await waitFor(() => expect(result.current.clusterIds).not.toBeNull());
    rerender({ f: null });
    await waitFor(() => expect(result.current.clusterIds).toBeNull());
  });
});
