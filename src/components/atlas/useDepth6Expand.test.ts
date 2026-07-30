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

describe("useDepth6Expand gated-count math", () => {
  it("counts depth-6+ children per gating parent", () => {
    const { result } = renderHook(() => useDepth6Expand(tree(), ""));
    expect(result.current.gatedCount.get("gp")).toBe(2);
    expect(result.current.gatedCount.get("c1")).toBe(1);
    expect(result.current.gatedCount.get("root")).toBeUndefined();
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

describe("useDepth6Expand auto-expansion edge cases", () => {
  it("does nothing when navigating to an id absent from entryById", () => {
    const { result } = renderHook(() => useDepth6Expand(tree(), "ghost"));
    expect(result.current.expandedParents.size).toBe(0);
  });

  it("stops walking up when a depth-6+ node has no parentId", () => {
    const root6 = makeNode({ id: "root6", depth: 6, parentId: null, doc_no: "A.1.1.1.1.1.1" });
    const flat = [root6].map((node) => makeFlatEntry({ node, depth: node.depth }));
    const { result } = renderHook(() => useDepth6Expand(flat, "root6"));
    // No parent to add, and root6 itself gates nothing — expandedParents stays empty.
    expect(result.current.expandedParents.size).toBe(0);
  });

  it("stops walking up when the parent id isn't in entryById (dangling parent)", () => {
    const orphan = makeNode({ id: "orphan", depth: 7, parentId: "phantom", doc_no: "A.1.1.1.1.1.1.1" });
    const flat = [orphan].map((node) => makeFlatEntry({ node, depth: node.depth }));
    const { result } = renderHook(() => useDepth6Expand(flat, "orphan"));
    // "phantom" gets added (best-effort) even though it has no entry to continue from.
    expect(result.current.expandedParents.has("phantom")).toBe(true);
  });
});

describe("useDepth6Expand setParentsExpanded (bulk reveal/re-gate)", () => {
  it("reveals a batch of ids at once", () => {
    const { result } = renderHook(() => useDepth6Expand(tree(), ""));
    act(() => result.current.setParentsExpanded(["gp", "c1"], true));
    expect(result.current.expandedParents.has("gp")).toBe(true);
    expect(result.current.expandedParents.has("c1")).toBe(true);
  });

  it("is a no-op (same reference) when the ids are already in the requested state", () => {
    const { result } = renderHook(() => useDepth6Expand(tree(), ""));
    act(() => result.current.setParentsExpanded(["gp"], true));
    const before = result.current.expandedParents;
    act(() => result.current.setParentsExpanded(["gp"], true));
    expect(result.current.expandedParents).toBe(before);
  });

  it("re-gates (hides) a previously revealed batch", () => {
    const { result } = renderHook(() => useDepth6Expand(tree(), ""));
    act(() => result.current.setParentsExpanded(["gp", "c1"], true));
    act(() => result.current.setParentsExpanded(["gp", "c1"], false));
    expect(result.current.expandedParents.has("gp")).toBe(false);
    expect(result.current.expandedParents.has("c1")).toBe(false);
  });
});

describe("useDepth6Expand mergeParentsExpanded (scoped snapshot restore)", () => {
  it("forces membership within the scope to match the snapshot, leaving the rest alone", () => {
    const { result } = renderHook(() => useDepth6Expand(tree(), ""));
    // c1 revealed and out-of-scope "gp" revealed before the restore.
    act(() => result.current.setParentsExpanded(["c1", "gp"], true));
    // Snapshot says: within the {c1, gc} branch, only gc should be revealed.
    act(() => result.current.mergeParentsExpanded(new Set(["gc"]), new Set(["c1", "gc"])));
    // c1 dropped (in scope, not in snapshot); gc added (in scope + snapshot);
    // gp untouched (outside the scope) — the whole point of the scoped merge.
    expect(result.current.expandedParents.has("c1")).toBe(false);
    expect(result.current.expandedParents.has("gc")).toBe(true);
    expect(result.current.expandedParents.has("gp")).toBe(true);
  });

  it("is a no-op (same reference) when the scope already matches the snapshot", () => {
    const { result } = renderHook(() => useDepth6Expand(tree(), ""));
    act(() => result.current.setParentsExpanded(["gp"], true));
    const before = result.current.expandedParents;
    act(() => result.current.mergeParentsExpanded(new Set(["gp"]), new Set(["gp"])));
    expect(result.current.expandedParents).toBe(before);
  });
});
