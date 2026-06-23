// @vitest-environment jsdom
// useDepth6Expand owns the depth-6 gating: how many descendants are hidden behind
// each gate, and which gates auto-open when you navigate to (or past) a deep node.
// Pure-ish state logic — driven directly with renderHook, no DOM geometry.

import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDepth6Expand } from "./useDepth6Expand";
import { makeFlatEntry, makeNode } from "../../test/fixtures";

// root(1) → gp(5) → c1(6) → gc(7)
//                  ↘ c2(6)
// gp gates two depth-6 children; c1 gates one depth-7 grandchild.
function tree() {
  const root = makeNode({ id: "root", depth: 1, parentId: null, doc_no: "A.1" });
  const gp = makeNode({ id: "gp", depth: 5, parentId: "root", doc_no: "A.1.1.1.1" });
  const c1 = makeNode({ id: "c1", depth: 6, parentId: "gp", doc_no: "A.1.1.1.1.1" });
  const c2 = makeNode({ id: "c2", depth: 6, parentId: "gp", doc_no: "A.1.1.1.1.2" });
  const gc = makeNode({ id: "gc", depth: 7, parentId: "c1", doc_no: "A.1.1.1.1.1.1" });
  return [root, gp, c1, c2, gc].map((node) => makeFlatEntry({ node, depth: node.depth }));
}

describe("useDepth6Expand hidden-count math", () => {
  it("counts depth-6+ children per gating parent", () => {
    const { result } = renderHook(() => useDepth6Expand(tree(), ""));
    expect(result.current.hiddenCount.get("gp")).toBe(2);
    expect(result.current.hiddenCount.get("c1")).toBe(1);
    expect(result.current.hiddenCount.get("root")).toBeUndefined();
  });
});

describe("useDepth6Expand auto-expansion", () => {
  it("does not expand anything before a node is selected", () => {
    const { result } = renderHook(() => useDepth6Expand(tree(), ""));
    expect(result.current.expandedParents.size).toBe(0);
  });

  it("expands the whole ancestor chain when navigating to a deep node", () => {
    const { result } = renderHook(() => useDepth6Expand(tree(), "gc"));
    // gc is depth 7 → both its depth-6 parent (c1) and the depth-5 gate (gp) open.
    expect(result.current.expandedParents.has("c1")).toBe(true);
    expect(result.current.expandedParents.has("gp")).toBe(true);
  });

  it("expands a node's own gate when it has gated descendants", () => {
    const { result } = renderHook(() => useDepth6Expand(tree(), "gp"));
    // gp is depth 5 (not itself gated) but gates 2 children → it opens itself.
    expect(result.current.expandedParents.has("gp")).toBe(true);
  });

  it("keeps prior expansions when navigating between deep nodes", () => {
    const { result, rerender } = renderHook(({ id }) => useDepth6Expand(tree(), id), {
      initialProps: { id: "gp" },
    });
    expect(result.current.expandedParents.has("gp")).toBe(true);
    rerender({ id: "gc" });
    expect(result.current.expandedParents.has("gp")).toBe(true);
    expect(result.current.expandedParents.has("c1")).toBe(true);
  });
});

describe("useDepth6Expand expandParent", () => {
  it("opens a gate on explicit request and is idempotent", () => {
    const { result } = renderHook(() => useDepth6Expand(tree(), ""));
    act(() => result.current.expandParent("gp"));
    expect(result.current.expandedParents.has("gp")).toBe(true);

    const before = result.current.expandedParents;
    act(() => result.current.expandParent("gp"));
    // Same Set reference — no needless re-render for an already-open gate.
    expect(result.current.expandedParents).toBe(before);
  });
});
