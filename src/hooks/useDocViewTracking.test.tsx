// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { AtlasNode } from "@/types";
import type { AtlasBundle } from "@/lib/docs";

const track = vi.fn();
const recordVisit = vi.fn();
const buildDocViewProps = vi.fn();

vi.mock("@/lib/analytics", () => ({
  track: (...a: unknown[]) => track(...a),
}));
vi.mock("@/lib/visitHistory", () => ({
  recordVisit: (...a: unknown[]) => recordVisit(...a),
}));
vi.mock("@/lib/atlasAnalytics", () => ({
  buildDocViewProps: (...a: unknown[]) => buildDocViewProps(...a),
}));

function wrapperFor(path: string, base = "") {
  const { hook } = memoryLocation({ path, record: true });
  return ({ children }: { children: React.ReactNode }) => (
    <Router hook={hook} base={base}>
      {children}
    </Router>
  );
}

function makeAtlas(id: string): AtlasBundle {
  const node = {
    id,
    doc_no: "A.1",
    title: "Doc Title",
    type: "Core",
    depth: 1,
    parentId: null,
    content: "",
    order: 0,
    addressRefs: [],
  } as AtlasNode;
  return {
    docs: { [id]: node },
    docNoToId: new Map(),
  } as unknown as AtlasBundle;
}

beforeEach(() => {
  vi.resetModules();
  track.mockClear();
  recordVisit.mockClear();
  buildDocViewProps.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useDocViewTracking", () => {
  it("does nothing when atlas is null", async () => {
    const { useDocViewTracking } = await import("./useDocViewTracking");
    renderHook(() => useDocViewTracking(null, "id-1", null), { wrapper: wrapperFor("/atlas") });
    expect(track).not.toHaveBeenCalled();
    expect(recordVisit).not.toHaveBeenCalled();
  });

  it("does nothing when id is empty", async () => {
    const atlas = makeAtlas("id-1");
    const { useDocViewTracking } = await import("./useDocViewTracking");
    renderHook(() => useDocViewTracking(atlas, "", null), { wrapper: wrapperFor("/atlas") });
    expect(track).not.toHaveBeenCalled();
    expect(recordVisit).not.toHaveBeenCalled();
  });

  it("does nothing when the id isn't in atlas.docs", async () => {
    const atlas = makeAtlas("id-1");
    const { useDocViewTracking } = await import("./useDocViewTracking");
    renderHook(() => useDocViewTracking(atlas, "missing-id", null), { wrapper: wrapperFor("/atlas") });
    expect(track).not.toHaveBeenCalled();
    expect(recordVisit).not.toHaveBeenCalled();
  });

  it("fires doc_view + recordVisit once the bundle has the node", async () => {
    const atlas = makeAtlas("id-1");
    buildDocViewProps.mockReturnValue({ node_id: "id-1", title: "Doc Title" });
    const { useDocViewTracking } = await import("./useDocViewTracking");
    renderHook(() => useDocViewTracking(atlas, "id-1", null), { wrapper: wrapperFor("/atlas") });
    expect(track).toHaveBeenCalledWith("doc_view", { node_id: "id-1", title: "Doc Title" });
    expect(recordVisit).toHaveBeenCalledWith({
      path: expect.stringContaining("id-1"),
      label: "Doc Title",
      base: "",
    });
  });

  it("skips track() when buildDocViewProps returns null, but still records the visit", async () => {
    const atlas = makeAtlas("id-1");
    buildDocViewProps.mockReturnValue(null);
    const { useDocViewTracking } = await import("./useDocViewTracking");
    renderHook(() => useDocViewTracking(atlas, "id-1", null), { wrapper: wrapperFor("/atlas") });
    expect(track).not.toHaveBeenCalled();
    expect(recordVisit).toHaveBeenCalledTimes(1);
  });

  it("re-fires when id changes but not when only graph changes", async () => {
    const atlas = makeAtlas("id-1");
    (atlas.docs as Record<string, AtlasNode>)["id-2"] = {
      ...(atlas.docs as Record<string, AtlasNode>)["id-1"],
      id: "id-2",
    };
    buildDocViewProps.mockReturnValue({ node_id: "id-1" });
    const { useDocViewTracking } = await import("./useDocViewTracking");
    const { rerender } = renderHook(
      ({ id, graph }: { id: string; graph: unknown }) => useDocViewTracking(atlas, id, graph as never),
      { wrapper: wrapperFor("/atlas"), initialProps: { id: "id-1", graph: null as unknown } },
    );
    expect(recordVisit).toHaveBeenCalledTimes(1);
    // graph-only change: eslint-disabled dep array omits graph, so no re-fire
    rerender({ id: "id-1", graph: { some: "graph" } });
    expect(recordVisit).toHaveBeenCalledTimes(1);
    rerender({ id: "id-2", graph: { some: "graph" } });
    expect(recordVisit).toHaveBeenCalledTimes(2);
  });
});
