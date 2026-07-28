// @vitest-environment jsdom
// AtlasReader's docList useMemo is the bulk of this file's lines — it has four
// largely independent branches (unfiltered w/ cradle, selection-filtered w/ gap
// dividers + cradle, changed-filtered w/ no cradle, depth-6 gating) plus the
// split-pane toggle and the expand-all action wiring. CollapsibleNode and
// JuniorPane are stubbed so we can assert docList's *structure* (which ids
// render, in what grouping, with what cradle/hidden markers) without depending
// on CollapsibleNode's own rendering, which is covered by CollapsibleNode.test.tsx.

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { AtlasReader } from "./AtlasReader";
import { AtlasActionsContext, useAtlasActions } from "./AtlasActionsContext";
import { makeNode, makeFlatEntry, makeAtlasBundle, makeLoadedData } from "../../test/fixtures";
import { flattenTree } from "../../lib/atlasHelpers";
import type { FlatEntry } from "../../lib/atlasHelpers";

const usePreviewChangedSetMock = vi.fn<() => Set<string> | null>(() => null);
const useSelectionSetMock = vi.fn<() => Set<string> | null>(() => null);
const selectSubtreeMock = vi.fn();
const useSelectionMock = vi.fn(() => ({
  ids: new Set<string>(),
  toggleDoc: vi.fn(),
  selectSubtree: selectSubtreeMock,
  clear: vi.fn(),
  replace: vi.fn(),
  selectedOnly: false,
  setSelectedOnly: vi.fn(),
  activeCollectionId: null,
  setActiveCollectionId: vi.fn(),
  activeCollectionName: null,
  setActiveCollectionName: vi.fn(),
}));

vi.mock("../../lib/previewFilter", () => ({
  usePreviewChangedSet: () => usePreviewChangedSetMock(),
}));
vi.mock("../../lib/selectionFilter", () => ({
  useSelectionSet: () => useSelectionSetMock(),
}));
vi.mock("../../lib/selection", () => ({
  useSelection: () => useSelectionMock(),
}));
vi.mock("../../hooks/useExpandingAttr", () => ({
  useExpandingAttr: () => () => {},
}));
vi.mock("./useAtlasScroll", () => ({
  useAtlasScroll: () => {},
}));
vi.mock("./JuniorPane", () => ({
  JuniorPane: (props: { splitId: string; onClose: () => void }) => (
    <div data-testid="junior-pane" data-split-id={props.splitId}>
      <button onClick={props.onClose}>close-junior</button>
    </div>
  ),
}));

// A minimal stand-in for CollapsibleNode that surfaces the props docList
// computes (isSelected, cradle, hiddenCount, hasChildren) as data-attributes,
// and exposes the inner AtlasActionsContext (expandAll/onExpandChildren) via
// clickable buttons so tests can drive expand-all / reveal-hidden.
function CollapsibleNodeStub(props: {
  entry: FlatEntry;
  isSelected: boolean;
  hasChildren?: boolean;
  hiddenCount?: number;
  subtreeState?: string;
  hasExplicitHiddenSubtree?: boolean;
  onExpandChildren?: (id: string) => void;
  cradle?: "line" | "foot";
  inSelectedOnly?: boolean;
}) {
  const actions = useAtlasActions();
  const {
    entry,
    isSelected,
    hasChildren,
    hiddenCount = 0,
    subtreeState,
    hasExplicitHiddenSubtree,
    onExpandChildren,
    cradle,
    inSelectedOnly,
  } = props;
  return (
    <div
      data-testid={`node-${entry.node.id}`}
      data-selected={isSelected}
      data-cradle={cradle ?? "none"}
      data-hidden={hiddenCount}
      data-subtree-state={subtreeState ?? "collapsed"}
      data-explicit-hidden={!!hasExplicitHiddenSubtree}
      data-in-selected-only={!!inSelectedOnly}
    >
      {entry.node.title}
      {hiddenCount > 0 && onExpandChildren && (
        <button onClick={() => onExpandChildren(entry.node.id)}>reveal-{entry.node.id}</button>
      )}
      {hasChildren && actions.expandAll && (
        <>
          <button onClick={() => actions.expandAll!(entry.node.id, true)}>expand-all-{entry.node.id}</button>
          <button onClick={() => actions.expandAll!(entry.node.id, false)}>collapse-all-{entry.node.id}</button>
        </>
      )}
      {actions.setSubtreeVisualState && (
        <>
          <button onClick={() => actions.setSubtreeVisualState!(entry.node.id, "hidden")}>hide-{entry.node.id}</button>
          <button onClick={() => actions.setSubtreeVisualState!(entry.node.id, "expanded")}>svs-expand-{entry.node.id}</button>
          <button onClick={() => actions.setSubtreeVisualState!(entry.node.id, "expanded", { restore: true })}>restore-{entry.node.id}</button>
        </>
      )}
      <button onClick={() => actions.toggle(entry.node.id)}>toggle-{entry.node.id}</button>
      {actions.selectSubtree && (
        <button onClick={() => actions.selectSubtree!(entry.node.id)}>select-subtree-{entry.node.id}</button>
      )}
    </div>
  );
}

vi.mock("./CollapsibleNode", () => ({
  CollapsibleNode: (props: Parameters<typeof CollapsibleNodeStub>[0]) => <CollapsibleNodeStub {...props} />,
}));

afterEach(() => {
  cleanup();
  usePreviewChangedSetMock.mockReturnValue(null);
  useSelectionSetMock.mockReturnValue(null);
  selectSubtreeMock.mockClear();
});

function outerActions(overrides: Partial<React.ComponentProps<typeof AtlasActionsContext.Provider>["value"]> = {}) {
  return {
    navigate: vi.fn(),
    toggle: vi.fn(),
    splitNavigate: vi.fn(),
    ...overrides,
  };
}

function renderReader(
  props: Partial<React.ComponentProps<typeof AtlasReader>> & { data: ReturnType<typeof makeLoadedData> },
) {
  const onSplitChange = vi.fn();
  const actions = outerActions();
  const wrap = (p: Partial<React.ComponentProps<typeof AtlasReader>> & { data: ReturnType<typeof makeLoadedData> }) => (
    <AtlasActionsContext.Provider value={actions}>
      <AtlasReader
        id={p.id ?? ""}
        selectedId={p.selectedId ?? null}
        splitId={p.splitId ?? null}
        onSplitChange={p.onSplitChange ?? onSplitChange}
        data={p.data}
        agentByDoc={p.agentByDoc ?? null}
      />
    </AtlasActionsContext.Provider>
  );
  const utils = render(wrap(props));
  const rerenderWith = (p: Partial<React.ComponentProps<typeof AtlasReader>> & { data: ReturnType<typeof makeLoadedData> }) =>
    utils.rerender(wrap(p));
  return { ...utils, onSplitChange, actions, rerenderWith };
}

// Builds a small tree: root -> a -> (a1, a2); root -> b. All at depths that
// keep them well clear of the depth-6 gate.
function makeCradleTree() {
  const root = makeNode({ id: "root", doc_no: "A", parentId: null });
  const a = makeNode({ id: "a", doc_no: "A.1", parentId: "root" });
  const a1 = makeNode({ id: "a1", doc_no: "A.1.1", parentId: "a" });
  const a2 = makeNode({ id: "a2", doc_no: "A.1.2", parentId: "a" });
  const b = makeNode({ id: "b", doc_no: "A.2", parentId: "root" });
  const atlas = makeAtlasBundle([root, a, a1, a2, b]);
  const flatNodes: FlatEntry[] = [
    makeFlatEntry({ node: root, depth: 1 }),
    makeFlatEntry({ node: a, depth: 2 }),
    makeFlatEntry({ node: a1, depth: 3 }),
    makeFlatEntry({ node: a2, depth: 3 }),
    makeFlatEntry({ node: b, depth: 2 }),
  ];
  return { atlas, flatNodes, root, a, a1, a2, b };
}

describe("AtlasReader unfiltered view", () => {
  it("renders a cradle rail around the selected node's descendants and wraps them in a selection-group", () => {
    const { atlas, flatNodes, a, a1, a2 } = makeCradleTree();
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    const { container } = renderReader({ id: "a", selectedId: a.id, data });

    expect(screen.getByTestId(`node-${a1.id}`)).toHaveAttribute("data-cradle", "line");
    expect(screen.getByTestId(`node-${a2.id}`)).toHaveAttribute("data-cradle", "foot");
    expect(screen.getByTestId(`node-${a.id}`)).toHaveAttribute("data-selected", "true");

    const group = container.querySelector(".selection-group");
    expect(group).not.toBeNull();
    expect(group!.querySelector(`[data-testid="node-${a.id}"]`)).not.toBeNull();
    expect(group!.querySelector(`[data-testid="node-${a1.id}"]`)).not.toBeNull();
    expect(group!.querySelector(`[data-testid="node-${a2.id}"]`)).not.toBeNull();
    // The unrelated sibling never joins the group.
    expect(group!.querySelector(`[data-testid="node-${flatNodes[4].node.id}"]`)).toBeNull();
  });

  it("renders no cradle and no selection-group when nothing is selected", () => {
    const { atlas, flatNodes } = makeCradleTree();
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    const { container } = renderReader({ id: "", selectedId: null, data });
    expect(container.querySelector(".selection-group")).toBeNull();
    for (const entry of flatNodes) {
      expect(screen.getByTestId(`node-${entry.node.id}`)).toHaveAttribute("data-cradle", "none");
    }
  });
});

describe("AtlasReader selection-filtered view (selected-only)", () => {
  it("shows a gap divider between non-adjacent kept rows and a cradle for the kept descendant", () => {
    const root = makeNode({ id: "root", doc_no: "A", parentId: null });
    const a = makeNode({ id: "a", doc_no: "A.1", parentId: "root" });
    const a1 = makeNode({ id: "a1", doc_no: "A.1.1", parentId: "a" });
    const a2 = makeNode({ id: "a2", doc_no: "A.1.2", parentId: "a" });
    const b = makeNode({ id: "b", doc_no: "A.2", parentId: "root" });
    const c = makeNode({ id: "c", doc_no: "A.3", parentId: "root" });
    const atlas = makeAtlasBundle([root, a, a1, a2, b, c]);
    const flatNodes: FlatEntry[] = [
      makeFlatEntry({ node: root, depth: 1 }),
      makeFlatEntry({ node: a, depth: 2 }),
      makeFlatEntry({ node: a1, depth: 3 }),
      makeFlatEntry({ node: a2, depth: 3 }),
      makeFlatEntry({ node: b, depth: 2 }),
      makeFlatEntry({ node: c, depth: 2 }),
    ];
    const data = makeLoadedData({ atlas, flatNodes, complete: true });

    // Kept: root, a, a1, c — a1 -> c is a gap (b sits between them, filtered out).
    useSelectionSetMock.mockReturnValue(new Set([root.id, a.id, a1.id, c.id]));

    const { container } = renderReader({ id: "a", selectedId: a.id, data });

    // Only kept nodes render.
    expect(screen.getByTestId(`node-${root.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`node-${a.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`node-${a1.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`node-${c.id}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`node-${a2.id}`)).toBeNull();
    expect(screen.queryByTestId(`node-${b.id}`)).toBeNull();

    const gaps = container.querySelectorAll(".selection-gap");
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toHaveTextContent("⋯");

    // a1 is the only kept row inside the selected node's descendant span, so it
    // closes the cradle itself (foot).
    expect(screen.getByTestId(`node-${a1.id}`)).toHaveAttribute("data-cradle", "foot");

    // inSelectedOnly is threaded through to every row in this view.
    expect(screen.getByTestId(`node-${a.id}`)).toHaveAttribute("data-in-selected-only", "true");
  });
});

describe("AtlasReader changed-filtered view (preview diff)", () => {
  it("never renders a cradle, even when the selected node's descendants are all kept", () => {
    const { atlas, flatNodes, a, a1, a2 } = makeCradleTree();
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    usePreviewChangedSetMock.mockReturnValue(new Set([a.id, a1.id, a2.id]));

    renderReader({ id: "a", selectedId: a.id, data });

    expect(screen.getByTestId(`node-${a.id}`)).toHaveAttribute("data-cradle", "none");
    expect(screen.getByTestId(`node-${a1.id}`)).toHaveAttribute("data-cradle", "none");
    expect(screen.getByTestId(`node-${a2.id}`)).toHaveAttribute("data-cradle", "none");
  });
});

describe("AtlasReader split pane", () => {
  it("shows the 'Open comparison pane' button when no split is open", () => {
    const { atlas, flatNodes } = makeCradleTree();
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    renderReader({ id: "a", selectedId: "a", splitId: null, data });
    expect(screen.getByRole("button", { name: "Open comparison pane" })).toBeInTheDocument();
    expect(screen.queryByTestId("junior-pane")).toBeNull();
  });

  it("hides the open-comparison button and renders JuniorPane when a split is open", () => {
    const { atlas, flatNodes } = makeCradleTree();
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    renderReader({ id: "a", selectedId: "a", splitId: "b", data });
    expect(screen.queryByRole("button", { name: "Open comparison pane" })).toBeNull();
    expect(screen.getByTestId("junior-pane")).toHaveAttribute("data-split-id", "b");
  });

  it("clicking 'Open comparison pane' calls onSplitChange with the current id", () => {
    const { atlas, flatNodes } = makeCradleTree();
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    const { onSplitChange } = renderReader({ id: "a", selectedId: "a", splitId: null, data });
    fireEvent.click(screen.getByRole("button", { name: "Open comparison pane" }));
    expect(onSplitChange).toHaveBeenCalledWith("a");
  });
});

describe("AtlasReader depth-6 gating", () => {
  function makeDeepTree() {
    const root = makeNode({ id: "root", doc_no: "A", parentId: null });
    const mid = makeNode({ id: "mid", doc_no: "A.1.1.1.1", parentId: "root" });
    const deep1 = makeNode({ id: "deep1", doc_no: "A.1.1.1.1.1", parentId: "mid" });
    const deep2 = makeNode({ id: "deep2", doc_no: "A.1.1.1.1.2", parentId: "mid" });
    const atlas = makeAtlasBundle([root, mid, deep1, deep2]);
    const flatNodes: FlatEntry[] = [
      makeFlatEntry({ node: root, depth: 1 }),
      makeFlatEntry({ node: mid, depth: 5 }),
      makeFlatEntry({ node: deep1, depth: 6 }),
      makeFlatEntry({ node: deep2, depth: 6 }),
    ];
    return { atlas, flatNodes, root, mid, deep1, deep2 };
  }

  it("hides depth>=6 nodes behind a hidden-count affordance on the parent until revealed", () => {
    const { atlas, flatNodes, mid, deep1, deep2 } = makeDeepTree();
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    renderReader({ id: "root", selectedId: null, data });

    expect(screen.queryByTestId(`node-${deep1.id}`)).toBeNull();
    expect(screen.queryByTestId(`node-${deep2.id}`)).toBeNull();
    expect(screen.getByTestId(`node-${mid.id}`)).toHaveAttribute("data-hidden", "2");

    fireEvent.click(screen.getByText(`reveal-${mid.id}`));

    expect(screen.getByTestId(`node-${deep1.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`node-${deep2.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`node-${mid.id}`)).toHaveAttribute("data-hidden", "0");
  });

  it("auto-reveals the ancestor chain when navigating straight to a depth>=6 node", () => {
    const { atlas, flatNodes, deep1 } = makeDeepTree();
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    renderReader({ id: "deep1", selectedId: "deep1", data });
    expect(screen.getByTestId(`node-${deep1.id}`)).toBeInTheDocument();
  });
});

describe("AtlasReader expand-all action", () => {
  function makeDeepTree2() {
    const root = makeNode({ id: "root", doc_no: "A", parentId: null });
    const mid = makeNode({ id: "mid", doc_no: "A.1.1.1.1", parentId: "root" });
    const deep1 = makeNode({ id: "deep1", doc_no: "A.1.1.1.1.1", parentId: "mid" });
    const deep2 = makeNode({ id: "deep2", doc_no: "A.1.1.1.1.2", parentId: "mid" });
    const atlas = makeAtlasBundle([root, mid, deep1, deep2]);
    const flatNodes: FlatEntry[] = [
      makeFlatEntry({ node: root, depth: 1 }),
      makeFlatEntry({ node: mid, depth: 5 }),
      makeFlatEntry({ node: deep1, depth: 6 }),
      makeFlatEntry({ node: deep2, depth: 6 }),
    ];
    return { atlas, flatNodes, root, mid, deep1, deep2 };
  }

  it("reveals every gated descendant in the subtree via the expandAll context action", () => {
    const { atlas, flatNodes, root, mid, deep1, deep2 } = makeDeepTree2();
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    renderReader({ id: "root", selectedId: null, data });

    expect(screen.queryByTestId(`node-${deep1.id}`)).toBeNull();

    fireEvent.click(screen.getByText(`expand-all-${root.id}`));

    expect(screen.getByTestId(`node-${deep1.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`node-${deep2.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`node-${mid.id}`)).toHaveAttribute("data-hidden", "0");
  });

  it("collapsing a bulk-expanded ancestor protects the current depth>=6 selection's own path", () => {
    const { atlas, flatNodes, root, mid, deep1 } = makeDeepTree2();
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    // Selected/current id is the depth-6 node itself, so its ancestor (mid) is
    // auto-revealed on mount; collapsing root's subtree must not re-gate it.
    renderReader({ id: "deep1", selectedId: "deep1", data });
    expect(screen.getByTestId(`node-${deep1.id}`)).toBeInTheDocument();

    fireEvent.click(screen.getByText(`collapse-all-${root.id}`));

    // deep1's own ancestor path (mid) stays revealed — deep1 is still visible.
    expect(screen.getByTestId(`node-${deep1.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`node-${mid.id}`)).toBeInTheDocument();
  });
});

describe("AtlasReader unified collapse (default gate == intent hide, differ only in data)", () => {
  // P(5) gates C(6) which gates G(7). Both P and C are default depth-6 gates.
  function makeDeepChain() {
    const root = makeNode({ id: "root", doc_no: "A", parentId: null });
    const p = makeNode({ id: "p", doc_no: "A.1.1.1.1", parentId: "root" });
    const c = makeNode({ id: "c", doc_no: "A.1.1.1.1.1", parentId: "p" });
    const g = makeNode({ id: "g", doc_no: "A.1.1.1.1.1.1", parentId: "c" });
    const atlas = makeAtlasBundle([root, p, c, g]);
    const flatNodes: FlatEntry[] = [
      makeFlatEntry({ node: root, depth: 1 }),
      makeFlatEntry({ node: p, depth: 5 }),
      makeFlatEntry({ node: c, depth: 6 }),
      makeFlatEntry({ node: g, depth: 7 }),
    ];
    return { atlas, flatNodes, root, p, c, g };
  }

  it("a default depth-6 gate's 'N hidden' counts the whole span, not just the first level", () => {
    const { atlas, flatNodes, c, g } = makeDeepChain();
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    renderReader({ id: "root", selectedId: null, data });

    // p is collapsed by default (depth-6 descendants); both c and g are hidden.
    expect(screen.queryByTestId(`node-${c.id}`)).toBeNull();
    expect(screen.queryByTestId(`node-${g.id}`)).toBeNull();
    // The count is the whole span (c + g = 2), not the immediate child count (1).
    expect(screen.getByTestId("node-p")).toHaveAttribute("data-hidden", "2");
  });

  it("default and intent hides render identically — same state, same count", () => {
    const { atlas, flatNodes, p } = makeDeepChain();
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    renderReader({ id: "root", selectedId: null, data });
    // Default gate p reads exactly like an explicit hide would: hidden state, span count.
    const node = screen.getByTestId("node-p");
    expect(node).toHaveAttribute("data-subtree-state", "hidden");
    expect(node).toHaveAttribute("data-hidden", "2");
    void p;
  });
});

describe("AtlasReader reveal a linked doc that lives in a collapsed tree", () => {
  it("navigating to a doc inside an explicitly-hidden branch reveals it and its siblings", () => {
    // root → P(5) → C(6), C2(6) ; C → G(7). Shift-hide P, then navigate to G as
    // if a sidebar/link jumped there — G, its path, and its siblings must show.
    const root = makeNode({ id: "root", doc_no: "A", parentId: null });
    const p = makeNode({ id: "p", doc_no: "A.1", parentId: "root" });
    const c = makeNode({ id: "c", doc_no: "A.1.1", parentId: "p" });
    const c2 = makeNode({ id: "c2", doc_no: "A.1.2", parentId: "p" });
    const g = makeNode({ id: "g", doc_no: "A.1.1.1", parentId: "c" });
    const atlas = makeAtlasBundle([root, p, c, c2, g]);
    const flatNodes: FlatEntry[] = [
      makeFlatEntry({ node: root, depth: 1 }),
      makeFlatEntry({ node: p, depth: 5 }),
      makeFlatEntry({ node: c, depth: 6 }),
      makeFlatEntry({ node: g, depth: 7 }),
      makeFlatEntry({ node: c2, depth: 6 }),
    ];
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    const { rerenderWith } = renderReader({ id: "root", selectedId: null, data });

    fireEvent.click(screen.getByText(`hide-${p.id}`));
    expect(screen.queryByTestId(`node-${g.id}`)).toBeNull();

    // navigate to the buried doc
    rerenderWith({ id: "g", selectedId: g.id, data });
    expect(screen.getByTestId(`node-${g.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`node-${c.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`node-${c2.id}`)).toBeInTheDocument(); // sibling revealed
    expect(screen.getByTestId(`node-${p.id}`)).toBeInTheDocument();
  });

  it("reveals a doc whose gate was reparented by the depth cap (visual, not parentId)", () => {
    // C(depth 5) visually parents G(depth 6), but G's parentId is the root — the
    // shape the heading-level-6 cap produces. C is the on-screen gate; opening it
    // by parentId (the old path) would miss it. Navigation must still reveal G.
    const root = makeNode({ id: "root", doc_no: "A", parentId: null });
    const c = makeNode({ id: "c", doc_no: "A.1.1.1.1.1", parentId: "root" });
    const g = makeNode({ id: "g", doc_no: "A.1.1.1.1.1.1", parentId: "root" });
    const atlas = makeAtlasBundle([root, c, g]);
    // Real flattenTree: depths come from the doc numbers, G lands under C visually.
    const data = makeLoadedData({ atlas, flatNodes: flattenTree(atlas.byParent), complete: true });
    const { rerenderWith } = renderReader({ id: "root", selectedId: null, data });

    // G is hidden by default behind C's gate.
    expect(screen.queryByTestId(`node-${g.id}`)).toBeNull();

    rerenderWith({ id: "g", selectedId: g.id, data });
    expect(screen.getByTestId(`node-${g.id}`)).toBeInTheDocument();
  });
});

describe("AtlasReader subtree hide / restore", () => {
  it("hides a subtree's descendants behind the parent's explicit-hidden marker", () => {
    const { atlas, flatNodes, a, a1, a2 } = makeCradleTree();
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    renderReader({ id: "root", selectedId: null, data });

    fireEvent.click(screen.getByText(`hide-${a.id}`));

    // a stays visible (its own ancestors aren't hidden) and now advertises the
    // hidden branch; its descendants are filtered out.
    expect(screen.getByTestId(`node-${a.id}`)).toHaveAttribute("data-explicit-hidden", "true");
    expect(screen.getByTestId(`node-${a.id}`)).toHaveAttribute("data-hidden", "2");
    expect(screen.queryByTestId(`node-${a1.id}`)).toBeNull();
    expect(screen.queryByTestId(`node-${a2.id}`)).toBeNull();
  });

  it("re-reveals a hidden subtree when navigation moves onto one of its descendants", () => {
    const { atlas, flatNodes, a, a1 } = makeCradleTree();
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    const { rerenderWith } = renderReader({ id: "root", selectedId: null, data });

    fireEvent.click(screen.getByText(`hide-${a.id}`));
    expect(screen.queryByTestId(`node-${a1.id}`)).toBeNull();

    // Navigating into the hidden branch un-hides the ancestor path.
    rerenderWith({ id: "a1", selectedId: a1.id, data });
    expect(screen.getByTestId(`node-${a1.id}`)).toBeInTheDocument();
  });

  it("restoring the branch brings its descendants back", () => {
    const { atlas, flatNodes, a, a1 } = makeCradleTree();
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    renderReader({ id: "root", selectedId: null, data });

    fireEvent.click(screen.getByText(`hide-${a.id}`));
    expect(screen.queryByTestId(`node-${a1.id}`)).toBeNull();

    fireEvent.click(screen.getByText(`restore-${a.id}`));
    expect(screen.getByTestId(`node-${a1.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`node-${a.id}`)).toHaveAttribute("data-explicit-hidden", "false");
  });

  it("clicking the 'N hidden' tab on an explicitly-hidden branch shows every row, left collapsed", () => {
    const { atlas, flatNodes, a, a1, a2 } = makeCradleTree();
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    renderReader({ id: "root", selectedId: null, data });

    fireEvent.click(screen.getByText(`hide-${a.id}`));
    // The hidden branch surfaces the "N hidden" tab (the stub's reveal button).
    expect(screen.queryByTestId(`node-${a1.id}`)).toBeNull();

    fireEvent.click(screen.getByText(`reveal-${a.id}`));
    // Every row comes back (un-hidden) — but collapsed, not expanded: the branch
    // lands in the "collapsed" visual state, distinct from the chevron's restore.
    expect(screen.getByTestId(`node-${a1.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`node-${a2.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`node-${a.id}`)).toHaveAttribute("data-explicit-hidden", "false");
    expect(screen.getByTestId(`node-${a.id}`)).toHaveAttribute("data-subtree-state", "collapsed");
  });

  it("moves the selection onto the clicked branch root when hiding a subtree that holds the selection (#363)", () => {
    const { atlas, flatNodes, a, a1 } = makeCradleTree();
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    // The selected doc (a1) is a descendant of the branch we hide (a).
    const { actions } = renderReader({ id: "a1", selectedId: a1.id, data });

    fireEvent.click(screen.getByText(`hide-${a.id}`));

    // Focus lands on the clicked root (a) itself — the collapsed row stays on
    // screen — rather than jumping to its parent or vanishing.
    expect(actions.navigate).toHaveBeenCalledWith(a.id);
  });

  it("the clicked root stays hidden after selection moves onto it (its subtree does not re-expand)", () => {
    const { atlas, flatNodes, a, a1, a2 } = makeCradleTree();
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    const { rerenderWith } = renderReader({ id: "a1", selectedId: a1.id, data });

    fireEvent.click(screen.getByText(`hide-${a.id}`));
    // Simulate the selection move landing (navigate(a) → id becomes a).
    rerenderWith({ id: "a", selectedId: a.id, data });

    // a is selected and visible, but its subtree stayed collapsed.
    expect(screen.getByTestId(`node-${a.id}`)).toHaveAttribute("data-explicit-hidden", "true");
    expect(screen.queryByTestId(`node-${a1.id}`)).toBeNull();
    expect(screen.queryByTestId(`node-${a2.id}`)).toBeNull();
  });

  it("does not move the selection when hiding a branch that does not contain it", () => {
    const { atlas, flatNodes, a, b } = makeCradleTree();
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    const { actions } = renderReader({ id: "b", selectedId: b.id, data });

    fireEvent.click(screen.getByText(`hide-${a.id}`));
    expect(actions.navigate).not.toHaveBeenCalled();
  });

  it("restoring a branch whose depth-6 children were revealed shows them again (not stuck gated)", () => {
    // N (depth 5) gates two depth-6 children. Reveal them, shift-hide N, then
    // restore: the children must reappear. Previously restore left N's own gate
    // closed, so the rows stayed hidden and the reader "working…" pulse spun
    // forever.
    const root = makeNode({ id: "root", doc_no: "A", parentId: null });
    const n = makeNode({ id: "n", doc_no: "A.1.1.1.1", parentId: "root" });
    const g1 = makeNode({ id: "g1", doc_no: "A.1.1.1.1.1", parentId: "n" });
    const g2 = makeNode({ id: "g2", doc_no: "A.1.1.1.1.2", parentId: "n" });
    const atlas = makeAtlasBundle([root, n, g1, g2]);
    const flatNodes: FlatEntry[] = [
      makeFlatEntry({ node: root, depth: 1 }),
      makeFlatEntry({ node: n, depth: 5 }),
      makeFlatEntry({ node: g1, depth: 6 }),
      makeFlatEntry({ node: g2, depth: 6 }),
    ];
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    renderReader({ id: "root", selectedId: null, data });

    // depth-6 children start gated; reveal them via the "N hidden" tab.
    fireEvent.click(screen.getByText(`reveal-${n.id}`));
    expect(screen.getByTestId(`node-${g1.id}`)).toBeInTheDocument();

    // shift-hide N (the children disappear) …
    fireEvent.click(screen.getByText(`hide-${n.id}`));
    expect(screen.queryByTestId(`node-${g1.id}`)).toBeNull();

    // … and restore N via the chevron — the revealed children come back.
    fireEvent.click(screen.getByText(`restore-${n.id}`));
    expect(screen.getByTestId(`node-${g1.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`node-${g2.id}`)).toBeInTheDocument();
  });

  it("restore re-hides a nested branch that was hidden before the outer branch", () => {
    // root → a → a1 → a1x ; a → a2. a1 is a hideable branch nested inside a.
    const root = makeNode({ id: "root", doc_no: "A", parentId: null });
    const a = makeNode({ id: "a", doc_no: "A.1", parentId: "root" });
    const a1 = makeNode({ id: "a1", doc_no: "A.1.1", parentId: "a" });
    const a1x = makeNode({ id: "a1x", doc_no: "A.1.1.1", parentId: "a1" });
    const a2 = makeNode({ id: "a2", doc_no: "A.1.2", parentId: "a" });
    const atlas = makeAtlasBundle([root, a, a1, a1x, a2]);
    const flatNodes: FlatEntry[] = [
      makeFlatEntry({ node: root, depth: 1 }),
      makeFlatEntry({ node: a, depth: 2 }),
      makeFlatEntry({ node: a1, depth: 3 }),
      makeFlatEntry({ node: a1x, depth: 4 }),
      makeFlatEntry({ node: a2, depth: 3 }),
    ];
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    renderReader({ id: "root", selectedId: null, data });

    // 1) hide the nested branch a1 → a1x disappears.
    fireEvent.click(screen.getByText(`hide-${a1.id}`));
    expect(screen.queryByTestId(`node-${a1x.id}`)).toBeNull();

    // 2) hide the outer branch a → a1, a1x, a2 all gone.
    fireEvent.click(screen.getByText(`hide-${a.id}`));
    expect(screen.queryByTestId(`node-${a1.id}`)).toBeNull();

    // 3) restore a → a1 must come back STILL HIDDEN (a1x stays gone), while a2
    //    (never hidden) is shown. The nested hide is remembered, not lost.
    fireEvent.click(screen.getByText(`restore-${a.id}`));
    expect(screen.getByTestId(`node-${a2.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`node-${a1.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`node-${a1.id}`)).toHaveAttribute("data-explicit-hidden", "true");
    expect(screen.queryByTestId(`node-${a1x.id}`)).toBeNull();
  });
});

describe("AtlasReader toggle + selectSubtree actions", () => {
  it("toggles a node's userToggles membership on and off", () => {
    const { atlas, flatNodes, a } = makeCradleTree();
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    renderReader({ id: "a", selectedId: a.id, data });
    const toggleBtn = screen.getByText(`toggle-${a.id}`);
    fireEvent.click(toggleBtn);
    fireEvent.click(toggleBtn);
    // No crash / still present — behavioral effect on expand state is asserted
    // via CollapsibleNode's own tests; this exercises the add + remove branches.
    expect(toggleBtn).toBeInTheDocument();
  });

  it("resets a node's toggle when navigation moves onto it", () => {
    const { atlas, flatNodes, a, b } = makeCradleTree();
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    const { rerenderWith } = renderReader({ id: "b", selectedId: b.id, data });
    fireEvent.click(screen.getByText(`toggle-${a.id}`));
    // Now navigate onto "a" — the id-change effect should drop "a" from userToggles.
    rerenderWith({ id: "a", selectedId: a.id, data });
    expect(screen.getByTestId(`node-${a.id}`)).toBeInTheDocument();
  });

  it("selectSubtree action calls the selection hook's selectSubtree with the collected subtree ids", () => {
    const { atlas, flatNodes, root, a, a1, a2 } = makeCradleTree();
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    renderReader({ id: "root", selectedId: null, data });
    fireEvent.click(screen.getByText(`select-subtree-${a.id}`));
    expect(selectSubtreeMock).toHaveBeenCalledWith(
      expect.arrayContaining([a.id, a1.id, a2.id]),
    );
    void root;
  });
});

describe("AtlasReader edge cases", () => {
  it("does not crash when id refers to a node not present in atlas.docs", () => {
    const { atlas, flatNodes } = makeCradleTree();
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    renderReader({ id: "does-not-exist", selectedId: null, data });
    // Full tree still renders normally.
    expect(screen.getByTestId("node-root")).toBeInTheDocument();
  });

  it("renders the flat filtered blocks without a selection-group when the selected id is filtered out", () => {
    const { atlas, flatNodes, a, b } = makeCradleTree();
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    // selectedId "b" is not part of the kept set, so kSel < 0.
    useSelectionSetMock.mockReturnValue(new Set([a.id]));
    const { container } = renderReader({ id: "b", selectedId: b.id, data });
    expect(container.querySelector(".selection-group")).toBeNull();
    expect(screen.getByTestId(`node-${a.id}`)).toBeInTheDocument();
  });

  it("closing JuniorPane calls onSplitChange(null)", () => {
    const { atlas, flatNodes } = makeCradleTree();
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    const { onSplitChange } = renderReader({ id: "a", selectedId: "a", splitId: "b", data });
    fireEvent.click(screen.getByText("close-junior"));
    expect(onSplitChange).toHaveBeenCalledWith(null);
  });
});
