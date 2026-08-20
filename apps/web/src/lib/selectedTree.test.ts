import { describe, it, expect } from "vitest";
import { buildSelectedOnlyNodes, selectedDescendantSet, selectedDescendantRunEnd } from "./selectedTree";
import { makeNode, makeAtlasBundle } from "../test/fixtures";

// parentOf = byParent inverted (id → parentId), the same map TreeSidebar builds.
function parentOfFrom(byParent: Map<string | null, ReturnType<typeof makeNode>[]>) {
  const m = new Map<string, string | null>();
  for (const [pid, kids] of byParent) for (const k of kids) m.set(k.id, pid);
  return m;
}

// A small tree:
//   parent (A.1)
//     childA (A.1.1)
//       grandA (A.1.1.1)
//     childB (A.1.2)
//   other  (A.2)
function tree() {
  const parent = makeNode({ id: "parent", doc_no: "A.1", parentId: null, order: 0 });
  const childA = makeNode({ id: "childA", doc_no: "A.1.1", parentId: "parent", order: 1 });
  const grandA = makeNode({ id: "grandA", doc_no: "A.1.1.1", parentId: "childA", order: 2 });
  const childB = makeNode({ id: "childB", doc_no: "A.1.2", parentId: "parent", order: 3 });
  const other = makeNode({ id: "other", doc_no: "A.2", parentId: null, order: 4 });
  const bundle = makeAtlasBundle([parent, childA, grandA, childB, other]);
  return { bundle };
}

const ids = (rows: ReturnType<typeof buildSelectedOnlyNodes>) => rows.map((r) => r.node.id);

describe("buildSelectedOnlyNodes", () => {
  it("shows ONLY the selected node — not its children — when only a parent is selected (the reported bug)", () => {
    const { bundle } = tree();
    const selected = new Set(["parent"]);
    // Even with `parent` marked expanded, its unselected children must NOT appear.
    const rows = buildSelectedOnlyNodes(bundle.byParent, selected, new Set(["parent"]));
    expect(ids(rows)).toEqual(["parent"]);
    // No selected descendants → no chevron.
    expect(rows[0].hasChildren).toBe(false);
  });

  it("gives a selected node a chevron when it has a selected descendant, and hides that descendant until expanded", () => {
    const { bundle } = tree();
    const selected = new Set(["parent", "childA"]);
    // parent collapsed → only parent shows, but with a chevron.
    const collapsed = buildSelectedOnlyNodes(bundle.byParent, selected, new Set());
    expect(ids(collapsed)).toEqual(["parent"]);
    expect(collapsed[0].hasChildren).toBe(true);
    // parent expanded → the selected child appears; the unselected sibling doesn't.
    const expanded = buildSelectedOnlyNodes(bundle.byParent, selected, new Set(["parent"]));
    expect(ids(expanded)).toEqual(["parent", "childA"]);
  });

  it("reveals only selected children on expand, never unselected ones", () => {
    const { bundle } = tree();
    // parent + childB selected; childA (and its subtree) NOT selected.
    const selected = new Set(["parent", "childB"]);
    const rows = buildSelectedOnlyNodes(bundle.byParent, selected, new Set(["parent"]));
    expect(ids(rows)).toEqual(["parent", "childB"]);
  });

  it("skips unselected intermediate ancestors, placing a deep selection at its true depth", () => {
    const { bundle } = tree();
    // Only the grandchild is selected; parent + childA are unselected intermediates.
    const selected = new Set(["grandA"]);
    const rows = buildSelectedOnlyNodes(bundle.byParent, selected, new Set());
    // It's a forest root of the selection, so it shows with no unselected rows above it.
    expect(ids(rows)).toEqual(["grandA"]);
    // Depth reflects the real doc_no nesting, not a flat 1.
    expect(rows[0].treeDepth).toBe(3);
  });

  it("nests selected descendants through an unselected gap once ancestors are expanded", () => {
    const { bundle } = tree();
    // parent selected, childA NOT selected, grandA selected (a gap in the middle).
    const selected = new Set(["parent", "grandA"]);
    // parent shows with a chevron (it has a selected descendant through the gap).
    expect(buildSelectedOnlyNodes(bundle.byParent, selected, new Set())[0].hasChildren).toBe(true);
    // Expanding parent AND the unselected intermediate childA surfaces grandA.
    const rows = buildSelectedOnlyNodes(bundle.byParent, selected, new Set(["parent", "childA"]));
    expect(ids(rows)).toEqual(["parent", "grandA"]);
  });

  it("selectedDescendantSet marks exactly the ancestors of selected nodes", () => {
    const { bundle } = tree();
    const set = selectedDescendantSet(bundle.byParent, new Set(["grandA"]));
    expect([...set].sort()).toEqual(["childA", "parent"]);
  });
});

describe("selectedDescendantRunEnd (cradle sizing)", () => {
  it("stops at a deeper-but-unrelated selected branch (the cradle-overshoot bug)", () => {
    // parent (A.1) open+selected with a selected child. A SEPARATE selected branch
    // sits lower in the flattened list AND deeper in doc_no (A.2.3.4), reached
    // through unselected intermediates. The old treeDepth>sel.treeDepth check
    // wrongly swept it into the cradle; the ancestry check must stop before it.
    const parent = makeNode({ id: "parent", doc_no: "A.1", parentId: null, order: 0 });
    const childA = makeNode({ id: "childA", doc_no: "A.1.1", parentId: "parent", order: 1 });
    const oA2 = makeNode({ id: "oA2", doc_no: "A.2", parentId: null, order: 2 });
    const oA23 = makeNode({ id: "oA23", doc_no: "A.2.3", parentId: "oA2", order: 3 });
    const deep = makeNode({ id: "deep", doc_no: "A.2.3.4", parentId: "oA23", order: 4 });
    const bundle = makeAtlasBundle([parent, childA, oA2, oA23, deep]);
    const parentOf = parentOfFrom(bundle.byParent);
    const selected = new Set(["parent", "childA", "deep"]);
    const rows = buildSelectedOnlyNodes(bundle.byParent, selected, new Set(["parent"]));
    expect(rows.map((r) => r.node.id)).toEqual(["parent", "childA", "deep"]);
    // `deep` is deeper than parent (treeDepth 3 > 1) but NOT its descendant — the
    // old logic overshot to include it; the fix stops the cradle after childA.
    expect(rows[2].treeDepth).toBeGreaterThan(rows[0].treeDepth);
    expect(selectedDescendantRunEnd(rows, 0, parentOf)).toBe(2); // exclusive end → covers only index 1 (childA)
  });

  it("covers the whole descendant run, across an unselected gap", () => {
    const { bundle } = tree();
    const parentOf = parentOfFrom(bundle.byParent);
    // parent selected, childA unselected gap, grandA selected; expand both.
    const selected = new Set(["parent", "grandA"]);
    const rows = buildSelectedOnlyNodes(bundle.byParent, selected, new Set(["parent", "childA"]));
    expect(rows.map((r) => r.node.id)).toEqual(["parent", "grandA"]);
    // grandA IS a true descendant of parent → run covers it.
    expect(selectedDescendantRunEnd(rows, 0, parentOf)).toBe(2);
  });

  it("returns selectedIndex+1 (empty run) when the selected node has no visible descendants", () => {
    const { bundle } = tree();
    const parentOf = parentOfFrom(bundle.byParent);
    const rows = buildSelectedOnlyNodes(bundle.byParent, new Set(["parent", "other"]), new Set());
    // parent(0), other(1) — siblings, neither descends from the other.
    expect(selectedDescendantRunEnd(rows, 0, parentOf)).toBe(1);
  });
});
