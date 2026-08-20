// @vitest-environment jsdom
// AtlasReader's docList useMemo is the bulk of this file's lines — it has four
// largely independent branches (unfiltered w/ cradle, selection-filtered w/ gap
// dividers + cradle, changed-filtered w/ no cradle, default-collapsed rows)
// plus the split-pane toggle and the pendulum action wiring. CollapsibleNode and
// JuniorPane are stubbed so we can assert docList's *structure* (which ids
// render, in what grouping, with what cradle/rung markers) without depending
// on CollapsibleNode's own rendering, which is covered by CollapsibleNode.test.tsx.

import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { AtlasReader, EXIT_MS } from "./AtlasReader";
import { AtlasActionsContext, useAtlasActions } from "./AtlasActionsContext";
import { makeNode, makeFlatEntry, makeAtlasBundle, makeLoadedData } from "../../test/fixtures";
import { flattenTree } from "@/lib/atlasHelpers";
import type { FlatEntry } from "@/lib/atlasHelpers";

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

vi.mock("@/lib/previewFilter", () => ({
  usePreviewChangedSet: () => usePreviewChangedSetMock(),
}));
vi.mock("@/lib/selectionFilter", () => ({
  useSelectionSet: () => useSelectionSetMock(),
}));
vi.mock("@/lib/selection", () => ({
  useSelection: () => useSelectionMock(),
}));
// Spied rather than stubbed away: which swings ARM the reveal animation is
// reader behavior worth asserting. What the trigger then does to the DOM is the
// hook's own business (see useExpandingAttr.test.ts).
const expandingTriggerMock = vi.fn();
vi.mock("../../hooks/useExpandingAttr", () => ({
  useExpandingAttr: () => expandingTriggerMock,
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
// computes (isSelected, cradle, gatedCount, hasChildren, rung) as
// data-attributes, and exposes the inner AtlasActionsContext (pendulum/
// onExpandChildren) via clickable buttons so tests can drive the » chevron /
// "N hidden" tab. Identity of the reader's inner actions-context object is
// recorded on every stub render so a test can assert it stays stable across
// an ordinary body toggle.
const capturedActions: unknown[] = [];

function CollapsibleNodeStub(props: {
  entry: FlatEntry;
  isSelected: boolean;
  isExpanded: boolean;
  hasChildren?: boolean;
  isExiting?: boolean;
  gatedCount?: number;
  rungLevel?: number;
  rungDir?: number;
  onExpandChildren?: (id: string) => void;
  cradle?: "line" | "foot";
  inSelectedOnly?: boolean;
}) {
  const actions = useAtlasActions();
  capturedActions.push(actions);
  const {
    entry,
    isSelected,
    isExpanded,
    hasChildren,
    isExiting,
    gatedCount = 0,
    rungLevel = 0,
    rungDir = 1,
    onExpandChildren,
    cradle,
    inSelectedOnly,
  } = props;
  return (
    <div
      data-testid={`node-${entry.node.id}`}
      data-selected={isSelected}
      data-cradle={cradle ?? "none"}
      data-hidden={gatedCount}
      data-rung-level={rungLevel}
      data-rung-dir={rungDir}
      data-expanded={isExpanded}
      data-in-selected-only={!!inSelectedOnly}
      data-exiting={isExiting ? "true" : undefined}
    >
      {entry.node.title}
      {gatedCount > 0 && onExpandChildren && (
        <button onClick={() => onExpandChildren(entry.node.id)}>reveal-{entry.node.id}</button>
      )}
      {hasChildren && actions.pendulum && (
        <>
          <button onClick={() => actions.pendulum!(entry.node.id)}>pendulum-{entry.node.id}</button>
          <button onClick={() => actions.pendulum!(entry.node.id, { reverse: true })}>
            reverse-{entry.node.id}
          </button>
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

// The exit fade keeps collapsing rows mounted for EXIT_MS. These suites assert
// collapse SEMANTICS (which rows end up hidden), not the transient, so report
// reduced motion by default — markExiting skips entirely then, and the DOM
// settles synchronously. The fade has its own dedicated test, which opts in.
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }),
  });
});

afterEach(() => {
  cleanup();
  usePreviewChangedSetMock.mockReturnValue(null);
  useSelectionSetMock.mockReturnValue(null);
  selectSubtreeMock.mockClear();
  expandingTriggerMock.mockClear();
  capturedActions.length = 0;
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

// The pendulum isn't a simple increment (0→1→2→1→0→1→2…, direction-dependent
// at level 1) so the number of clicks needed to reach a target level depends
// on where it currently is. Read the level back off the DOM and click until
// it matches, rather than counting clicks analytically.
function cycleTo(id: string, level: 0 | 1 | 2) {
  for (let i = 0; i < 6; i++) {
    if (screen.getByTestId(`node-${id}`).getAttribute("data-rung-level") === String(level)) return;
    fireEvent.click(screen.getByText(`pendulum-${id}`));
  }
  throw new Error(`cycleTo(${id}, ${level}) did not converge`);
}

// Builds a small tree: root -> a -> (a1, a2); root -> b. All at depths that
// keep them well clear of any depth cap.
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
    // Navigating straight to "a" raises a's own rung to 1 (reveal-on-nav also
    // raises the target, not just its ancestors), so its children render.
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

  // `data-expanding` is what lets newly inserted rows/bodies run their
  // @starting-style entrance (index.css). It has to be armed on the swings that
  // INSERT something — 0 → 1 adds child rows, 1 → 2 adds their bodies — and left
  // alone on the inward swings, which only remove nodes.
  it("arms the reveal animation on outward pendulum swings only", () => {
    const { atlas, flatNodes, a } = makeCradleTree();
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    renderReader({ id: "root", data });
    cycleTo(a.id, 0);
    expandingTriggerMock.mockClear();

    // 0 → 1 inserts the child rows; 1 → 2 inserts their bodies.
    fireEvent.click(screen.getByText(`pendulum-${a.id}`));
    expect(screen.getByTestId(`node-${a.id}`)).toHaveAttribute("data-rung-level", "1");
    expect(expandingTriggerMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText(`pendulum-${a.id}`));
    expect(screen.getByTestId(`node-${a.id}`)).toHaveAttribute("data-rung-level", "2");
    expect(expandingTriggerMock).toHaveBeenCalledTimes(2);

    // 2 → 1 only removes bodies — nothing is inserted, so nothing is armed.
    fireEvent.click(screen.getByText(`pendulum-${a.id}`));
    expect(screen.getByTestId(`node-${a.id}`)).toHaveAttribute("data-rung-level", "1");
    expect(expandingTriggerMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the actions context referentially stable across an ordinary body toggle", () => {
    const { atlas, flatNodes, b } = makeCradleTree();
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    renderReader({ id: "a", selectedId: "a", data });
    const before = capturedActions[capturedActions.length - 1];
    expect(before).toBeDefined();
    capturedActions.length = 0;

    // A plain body toggle changes userToggles; the memo boundary must hold, so
    // the actions object handed to every row must be the same reference.
    fireEvent.click(screen.getByText(`toggle-${b.id}`));
    expect(capturedActions.length).toBeGreaterThan(0);
    for (const a of capturedActions) expect(a).toBe(before);
  });

  it("keeps the actions context referentially stable across navigation (doc click)", () => {
    const { atlas, flatNodes } = makeCradleTree();
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    const { rerenderWith } = renderReader({ id: "a", selectedId: "a", data });
    const before = capturedActions[capturedActions.length - 1];
    expect(before).toBeDefined();
    capturedActions.length = 0;

    // Navigating changes id, which gives expandedSet (and the rung map) a
    // fresh reveal. If that leaks into the actions object, every one of the
    // ~1200 rows re-renders on each doc click (the click-to-select lag). The
    // context must stay the same reference so only the selection-changed
    // rows re-render.
    rerenderWith({ id: "b", selectedId: "b", data });
    expect(capturedActions.length).toBeGreaterThan(0);
    for (const ac of capturedActions) expect(ac).toBe(before);
  });

  it("renders no cradle and no selection-group when nothing is selected — and only the top-level row, since nothing has been revealed", () => {
    const { atlas, flatNodes, root, a } = makeCradleTree();
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    const { container } = renderReader({ id: "", selectedId: null, data });
    expect(container.querySelector(".selection-group")).toBeNull();
    // With no id, the reveal-on-nav effect bails before running — only the
    // top-of-forest row (root) renders; its children stay collapsed by default.
    expect(screen.getByTestId(`node-${root.id}`)).toHaveAttribute("data-cradle", "none");
    expect(screen.queryByTestId(`node-${a.id}`)).toBeNull();
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

  it("required #5: never shows an 'N hidden' tab, even under a branch collapsed by default", () => {
    const { atlas, flatNodes, a } = makeCradleTree();
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    usePreviewChangedSetMock.mockReturnValue(new Set([a.id]));
    renderReader({ id: "root", selectedId: null, data });
    // The filtered branch fixes gatedCount at 0 so a real (but here invisible)
    // rung-0 branch never sprouts a working "N hidden" tab in this view.
    expect(screen.getByTestId(`node-${a.id}`)).toHaveAttribute("data-hidden", "0");
    expect(screen.queryByText(`reveal-${a.id}`)).toBeNull();
  });
});

describe("AtlasReader filtered view ignores collapse state", () => {
  // Two sibling branches, each collapsed by default: root -> midA -> deepA; root -> midB -> deepB.
  function makeTwoGatedBranches() {
    const root = makeNode({ id: "root", doc_no: "A", parentId: null });
    const midA = makeNode({ id: "midA", doc_no: "A.1", parentId: "root" });
    const deepA = makeNode({ id: "deepA", doc_no: "A.1.1", parentId: "midA" });
    const midB = makeNode({ id: "midB", doc_no: "A.2", parentId: "root" });
    const deepB = makeNode({ id: "deepB", doc_no: "A.2.1", parentId: "midB" });
    const atlas = makeAtlasBundle([root, midA, deepA, midB, deepB]);
    const flatNodes: FlatEntry[] = [
      makeFlatEntry({ node: root, depth: 1 }),
      makeFlatEntry({ node: midA, depth: 2 }),
      makeFlatEntry({ node: deepA, depth: 3 }),
      makeFlatEntry({ node: midB, depth: 2 }),
      makeFlatEntry({ node: deepB, depth: 3 }),
    ];
    return { atlas, flatNodes, root, midA, deepA, midB, deepB };
  }

  it("keeps a selected doc whose branch is still collapsed (selected-only)", () => {
    const { atlas, flatNodes, root, deepA } = makeTwoGatedBranches();
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    // Selection includes the deep doc, but we sit on root so its branch
    // (midA) is never revealed by the reveal-on-nav effect.
    useSelectionSetMock.mockReturnValue(new Set([root.id, deepA.id]));
    renderReader({ id: "root", selectedId: root.id, data });
    // Pre-fix, deepA landed in hiddenNodeIds and was dropped from the subset.
    expect(screen.getByTestId(`node-${deepA.id}`)).toBeInTheDocument();
  });

  it("keeps multiple selected deep docs under different collapsed branches (selected-only)", () => {
    const { atlas, flatNodes, deepA, deepB } = makeTwoGatedBranches();
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    useSelectionSetMock.mockReturnValue(new Set([deepA.id, deepB.id]));
    renderReader({ id: "root", selectedId: null, data });
    expect(screen.getByTestId(`node-${deepA.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`node-${deepB.id}`)).toBeInTheDocument();
  });

  it("keeps a changed doc inside a collapsed branch (changed-only preview)", () => {
    const root = makeNode({ id: "root", doc_no: "A", parentId: null });
    const p = makeNode({ id: "p", doc_no: "A.1", parentId: "root" });
    const d = makeNode({ id: "d", doc_no: "A.1.1", parentId: "p" });
    const atlas = makeAtlasBundle([root, p, d]);
    const flatNodes: FlatEntry[] = [
      makeFlatEntry({ node: root, depth: 1 }),
      makeFlatEntry({ node: p, depth: 2 }),
      makeFlatEntry({ node: d, depth: 3 }),
    ];
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    usePreviewChangedSetMock.mockReturnValue(new Set([p.id, d.id]));
    renderReader({ id: "p", selectedId: null, data });
    expect(screen.getByTestId(`node-${d.id}`)).toBeInTheDocument();

    // Click p's pendulum from within the filtered view. The real rung state
    // changes underneath, but the changed-only branch is collapse-blind by
    // construction (rungLevel fixed at 1 for display, gatedCount fixed at 0)
    // — the changed descendant must not silently drop out of the diff
    // review regardless of what the click does to the real rung.
    fireEvent.click(screen.getByText(`pendulum-${p.id}`));
    expect(screen.getByTestId(`node-${d.id}`)).toBeInTheDocument();
  });

  // Regression: the filtered branch used to hardcode rungLevel={1} for every
  // row's chevron display, even though handlePendulum (fed the SAME shared rung
  // map) actually advances it — so after one click the chevron looked stuck at
  // "titles" while the underlying rung had already moved to "bodies open".
  it("reflects the real rung level on the chevron after a pendulum click (selected-only)", () => {
    const { atlas, flatNodes, midA, deepA } = makeTwoGatedBranches();
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    useSelectionSetMock.mockReturnValue(new Set([midA.id, deepA.id]));
    renderReader({ id: "root", selectedId: null, data });
    // Real rung is 0 (untouched), but 0 is invisible in a flat view (see next
    // test) — it displays as its stand-in, 1.
    expect(screen.getByTestId(`node-${midA.id}`)).toHaveAttribute("data-rung-level", "1");

    // Flat view swings only between 1 and 2 — never back down to 0.
    fireEvent.click(screen.getByText(`pendulum-${midA.id}`));
    expect(screen.getByTestId(`node-${midA.id}`)).toHaveAttribute("data-rung-level", "2");
    fireEvent.click(screen.getByText(`pendulum-${midA.id}`));
    expect(screen.getByTestId(`node-${midA.id}`)).toHaveAttribute("data-rung-level", "1");
    fireEvent.click(screen.getByText(`pendulum-${midA.id}`));
    expect(screen.getByTestId(`node-${midA.id}`)).toHaveAttribute("data-rung-level", "2");
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

describe("AtlasReader default collapse (first paint)", () => {
  function makeDeepTree() {
    const root = makeNode({ id: "root", doc_no: "A", parentId: null });
    const mid = makeNode({ id: "mid", doc_no: "A.1", parentId: "root" });
    const deep1 = makeNode({ id: "deep1", doc_no: "A.1.1", parentId: "mid" });
    const deep2 = makeNode({ id: "deep2", doc_no: "A.1.2", parentId: "mid" });
    const atlas = makeAtlasBundle([root, mid, deep1, deep2]);
    const flatNodes: FlatEntry[] = [
      makeFlatEntry({ node: root, depth: 1 }),
      makeFlatEntry({ node: mid, depth: 2 }),
      makeFlatEntry({ node: deep1, depth: 3 }),
      makeFlatEntry({ node: deep2, depth: 3 }),
    ];
    return { atlas, flatNodes, root, mid, deep1, deep2 };
  }

  it("children sit behind an N-hidden tab until revealed", () => {
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

  it("navigating straight to a deep, unrevealed node auto-reveals its ancestor chain", () => {
    const { atlas, flatNodes, deep1 } = makeDeepTree();
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    renderReader({ id: "deep1", selectedId: "deep1", data });
    expect(screen.getByTestId(`node-${deep1.id}`)).toBeInTheDocument();
  });

  it("required #6: first paint shows only the top-level row, with a working chevron and an N-hidden tab", () => {
    const { atlas, flatNodes } = makeCradleTree();
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    renderReader({ id: "", selectedId: null, data });

    // Only root renders — a, a1, a2, b are all collapsed by default.
    expect(screen.getByTestId("node-root")).toBeInTheDocument();
    expect(screen.queryByTestId("node-a")).toBeNull();
    expect(screen.queryByTestId("node-b")).toBeNull();

    // root has children and a pendulum action, so it gets a working chevron
    // and an "N hidden" tab spanning its whole subtree (a, a1, a2, b = 4).
    expect(screen.getByText("pendulum-root")).toBeInTheDocument();
    expect(screen.getByTestId("node-root")).toHaveAttribute("data-hidden", "4");
  });
});

describe("AtlasReader default collapse spans multiple levels", () => {
  // P gates C which gates G — all collapsed by default (rung 0) until revealed.
  function makeDeepChain() {
    const root = makeNode({ id: "root", doc_no: "A", parentId: null });
    const p = makeNode({ id: "p", doc_no: "A.1", parentId: "root" });
    const c = makeNode({ id: "c", doc_no: "A.1.1", parentId: "p" });
    const g = makeNode({ id: "g", doc_no: "A.1.1.1", parentId: "c" });
    const atlas = makeAtlasBundle([root, p, c, g]);
    const flatNodes: FlatEntry[] = [
      makeFlatEntry({ node: root, depth: 1 }),
      makeFlatEntry({ node: p, depth: 2 }),
      makeFlatEntry({ node: c, depth: 3 }),
      makeFlatEntry({ node: g, depth: 4 }),
    ];
    return { atlas, flatNodes, root, p, c, g };
  }

  it("a collapsed branch's 'N hidden' counts the whole span, not just the immediate children", () => {
    const { atlas, flatNodes, c, g } = makeDeepChain();
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    renderReader({ id: "root", selectedId: null, data });

    // p is collapsed by default; both c and g (nested two levels deep) are hidden.
    expect(screen.queryByTestId(`node-${c.id}`)).toBeNull();
    expect(screen.queryByTestId(`node-${g.id}`)).toBeNull();
    // The count is the whole span (c + g = 2), not the immediate child count (1).
    expect(screen.getByTestId("node-p")).toHaveAttribute("data-hidden", "2");
  });

  it("a collapsed branch reads at rung 0 with the whole span counted", () => {
    const { atlas, flatNodes, p } = makeDeepChain();
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    renderReader({ id: "root", selectedId: null, data });
    const node = screen.getByTestId("node-p");
    expect(node).toHaveAttribute("data-rung-level", "0");
    expect(node).toHaveAttribute("data-hidden", "2");
    void p;
  });
});

describe("AtlasReader reveal a linked doc that lives in a collapsed tree", () => {
  it("navigating to a doc inside a collapsed branch reveals it and its siblings", () => {
    // root → p → c, c2; c → g. p's own branch is collapsed by default —
    // only root itself gets auto-revealed by the initial navigation.
    const root = makeNode({ id: "root", doc_no: "A", parentId: null });
    const p = makeNode({ id: "p", doc_no: "A.1", parentId: "root" });
    const c = makeNode({ id: "c", doc_no: "A.1.1", parentId: "p" });
    const c2 = makeNode({ id: "c2", doc_no: "A.1.2", parentId: "p" });
    const g = makeNode({ id: "g", doc_no: "A.1.1.1", parentId: "c" });
    const atlas = makeAtlasBundle([root, p, c, c2, g]);
    const flatNodes: FlatEntry[] = [
      makeFlatEntry({ node: root, depth: 1 }),
      makeFlatEntry({ node: p, depth: 2 }),
      makeFlatEntry({ node: c, depth: 3 }),
      makeFlatEntry({ node: g, depth: 4 }),
      makeFlatEntry({ node: c2, depth: 3 }),
    ];
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    const { rerenderWith } = renderReader({ id: "root", selectedId: null, data });

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

    // G is hidden by default behind C's chevron.
    expect(screen.queryByTestId(`node-${g.id}`)).toBeNull();

    rerenderWith({ id: "g", selectedId: g.id, data });
    expect(screen.getByTestId(`node-${g.id}`)).toBeInTheDocument();
  });
});

describe("AtlasReader pendulum collapse / reveal (branch-level)", () => {
  it("collapsing an open branch hides its descendants behind the chevron's N-hidden count", () => {
    const { atlas, flatNodes, a, a1, a2 } = makeCradleTree();
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    renderReader({ id: "root", selectedId: null, data });

    // a starts collapsed by default; open it to rung 2 first so there's
    // something to collapse.
    cycleTo(a.id, 2);
    expect(screen.getByTestId(`node-${a1.id}`)).toBeInTheDocument();

    cycleTo(a.id, 0);
    expect(screen.getByTestId(`node-${a.id}`)).toHaveAttribute("data-hidden", "2");
    expect(screen.queryByTestId(`node-${a1.id}`)).toBeNull();
    expect(screen.queryByTestId(`node-${a2.id}`)).toBeNull();
  });

  it("reveals a still-collapsed branch when navigation moves onto one of its descendants", () => {
    const { atlas, flatNodes, a1 } = makeCradleTree();
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    const { rerenderWith } = renderReader({ id: "root", selectedId: null, data });

    expect(screen.queryByTestId(`node-${a1.id}`)).toBeNull();

    // Navigating into the collapsed branch raises its ancestor's rung.
    rerenderWith({ id: "a1", selectedId: a1.id, data });
    expect(screen.getByTestId(`node-${a1.id}`)).toBeInTheDocument();
  });

  it("clicking the 'N hidden' tab reveals every descendant row, each left at rung 1 (titles only)", () => {
    const { atlas, flatNodes, a, a1, a2 } = makeCradleTree();
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    renderReader({ id: "root", selectedId: null, data });

    // a is collapsed by default — the "N hidden" tab (the stub's reveal button).
    expect(screen.queryByTestId(`node-${a1.id}`)).toBeNull();

    fireEvent.click(screen.getByText(`reveal-${a.id}`));
    // Every row in the span comes back — but at rung 1 (titles only), not
    // rung 2 (bodies open): the tab discloses, it doesn't fully expand.
    expect(screen.getByTestId(`node-${a1.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`node-${a2.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`node-${a.id}`)).toHaveAttribute("data-rung-level", "1");
  });

  it("moves the selection onto the clicked branch root when collapsing a branch that holds the selection (#363)", () => {
    const { atlas, flatNodes, a, a1 } = makeCradleTree();
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    // The selected doc (a1) is a descendant of the branch we collapse (a).
    // Navigating to a1 raises "a" to rung 1 (post-nav default); collapsing it
    // to 0 takes 3 clicks (1→2→1→0).
    const { actions } = renderReader({ id: "a1", selectedId: a1.id, data });

    cycleTo(a.id, 0);

    // Focus lands on the clicked root (a) itself — the collapsed row stays on
    // screen — rather than jumping to its parent or vanishing.
    expect(actions.navigate).toHaveBeenCalledWith(a.id);
  });

  it("required #4: the clicked root stays collapsed after the selection move lands (self-collapse survives navigation)", () => {
    const { atlas, flatNodes, a, a1, a2 } = makeCradleTree();
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    const { rerenderWith } = renderReader({ id: "a1", selectedId: a1.id, data });

    cycleTo(a.id, 0);
    // Simulate the selection move landing (navigate(a) → id becomes a).
    rerenderWith({ id: "a", selectedId: a.id, data });

    // a is selected and visible, but its subtree stayed collapsed — the
    // reveal-on-nav effect must not spring it back open just because the
    // selection landed on it (the two self-undo bugs the guard refs exist for).
    expect(screen.getByTestId(`node-${a.id}`)).toHaveAttribute("data-rung-level", "0");
    expect(screen.queryByTestId(`node-${a1.id}`)).toBeNull();
    expect(screen.queryByTestId(`node-${a2.id}`)).toBeNull();
  });

  it("does not move the selection when collapsing a branch that does not contain it", () => {
    const { atlas, flatNodes, a, b } = makeCradleTree();
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    const { actions } = renderReader({ id: "b", selectedId: b.id, data });

    // Full pendulum cycle 0→1→2→1→0 on a branch that never holds the
    // selection — collapsing it must never call navigate.
    const btn = screen.getByText(`pendulum-${a.id}`);
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(screen.getByTestId(`node-${a.id}`)).toHaveAttribute("data-rung-level", "0");
    expect(actions.navigate).not.toHaveBeenCalled();
  });
});

describe("AtlasReader pendulum mechanics (required regression coverage)", () => {
  it("required #1: direction memory — after swinging out to rung 2 and back to 1, the next click goes to 0, not 2", () => {
    const { atlas, flatNodes, a } = makeCradleTree();
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    renderReader({ id: "root", selectedId: null, data });

    cycleTo(a.id, 2);
    const btn = screen.getByText(`pendulum-${a.id}`);
    fireEvent.click(btn); // 2 → 1 (dir now -1)
    expect(screen.getByTestId(`node-${a.id}`)).toHaveAttribute("data-rung-level", "1");
    fireEvent.click(btn); // 1 → 0, the pendulum swinging back, not wrapping to 2.
    expect(screen.getByTestId(`node-${a.id}`)).toHaveAttribute("data-rung-level", "0");
  });

  function makeNestedTree() {
    const root = makeNode({ id: "root", doc_no: "A", parentId: null });
    const a = makeNode({ id: "a", doc_no: "A.1", parentId: "root" });
    const a1 = makeNode({ id: "a1", doc_no: "A.1.1", parentId: "a" });
    const a1x = makeNode({ id: "a1x", doc_no: "A.1.1.1", parentId: "a1" });
    const atlas = makeAtlasBundle([root, a, a1, a1x]);
    const flatNodes: FlatEntry[] = [
      makeFlatEntry({ node: root, depth: 1 }),
      makeFlatEntry({ node: a, depth: 2 }),
      makeFlatEntry({ node: a1, depth: 3 }),
      makeFlatEntry({ node: a1x, depth: 4 }),
    ];
    return { atlas, flatNodes, root, a, a1, a1x };
  }

  it("required #2: preserves a nested branch's rung across an outer collapse/re-expand", () => {
    const { atlas, flatNodes, a, a1, a1x } = makeNestedTree();
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    renderReader({ id: "root", selectedId: null, data });

    // Open both levels: a to 1 (a1 visible), then a1 to 2 (a1x visible).
    cycleTo(a.id, 1);
    cycleTo(a1.id, 2);
    expect(screen.getByTestId(`node-${a1x.id}`)).toBeInTheDocument();

    // Collapse the OUTER branch — a1 (and its rung-2 state) drops out of
    // view entirely. Collapsing writes nothing about a1's own rung.
    cycleTo(a.id, 0);
    expect(screen.queryByTestId(`node-${a1.id}`)).toBeNull();

    // Re-open a to 1 — a1 reappears exactly as it was left: still rung 2.
    cycleTo(a.id, 1);
    expect(screen.getByTestId(`node-${a1.id}`)).toHaveAttribute("data-rung-level", "2");
    expect(screen.getByTestId(`node-${a1x.id}`)).toBeInTheDocument();
  });

  it("rung 2 opens the clicked doc's OWN body, not just its children's", () => {
    const { atlas, flatNodes, a, a1, a2 } = makeCradleTree();
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    renderReader({ id: "root", data });

    cycleTo(a.id, 2);
    for (const id of [a.id, a1.id, a2.id]) {
      expect(screen.getByTestId(`node-${id}`)).toHaveAttribute("data-expanded", "true");
    }

    // The 2 → 1 swing back closes the same set it opened, root included, so the
    // chevron can always undo itself.
    cycleTo(a.id, 1);
    for (const id of [a.id, a1.id, a2.id]) {
      expect(screen.getByTestId(`node-${id}`)).toHaveAttribute("data-expanded", "false");
    }
  });

  // Opts INTO motion (the suite default reports reduced motion, see beforeAll):
  // a collapsing row must stay mounted long enough to fade, then leave the DOM
  // for good — the end state is identical to an instant removal.
  it("keeps collapsing rows mounted and inert while they fade, then unmounts them", () => {
    const realMatchMedia = window.matchMedia;
    (window as unknown as { matchMedia: unknown }).matchMedia = () => ({ matches: false });
    vi.useFakeTimers();
    try {
      const { atlas, flatNodes, a, a1, a2 } = makeCradleTree();
      const data = makeLoadedData({ atlas, flatNodes, complete: true });
      renderReader({ id: "root", data });
      cycleTo(a.id, 1);
      expect(screen.getByTestId(`node-${a1.id}`)).toBeInTheDocument();

      cycleTo(a.id, 0);
      // Still rendered — but marked, so CSS can fade it and clicks pass it by.
      for (const id of [a1.id, a2.id]) {
        expect(screen.getByTestId(`node-${id}`)).toHaveAttribute("data-exiting", "true");
      }

      act(() => vi.advanceTimersByTime(EXIT_MS + 20));
      for (const id of [a1.id, a2.id]) {
        expect(screen.queryByTestId(`node-${id}`)).toBeNull();
      }
    } finally {
      vi.useRealTimers();
      (window as unknown as { matchMedia: unknown }).matchMedia = realMatchMedia;
    }
  });

  // Regression: markExiting used to hold a single shared exitingIds/timer slot,
  // so collapsing branch B while branch A was still fading would overwrite A's
  // entry and cancel its timer — A's rows then vanished instantly instead of
  // finishing their exit animation. Each collapse now owns its own timer and
  // only ever removes its own ids from exitingIds.
  it("finishes both exit fades when two branches collapse within EXIT_MS of each other", () => {
    const realMatchMedia = window.matchMedia;
    (window as unknown as { matchMedia: unknown }).matchMedia = () => ({ matches: false });
    vi.useFakeTimers();
    try {
      const root = makeNode({ id: "root", doc_no: "A", parentId: null });
      const a = makeNode({ id: "a", doc_no: "A.1", parentId: "root" });
      const a1 = makeNode({ id: "a1", doc_no: "A.1.1", parentId: "a" });
      const b = makeNode({ id: "b", doc_no: "A.2", parentId: "root" });
      const b1 = makeNode({ id: "b1", doc_no: "A.2.1", parentId: "b" });
      const atlas = makeAtlasBundle([root, a, a1, b, b1]);
      const flatNodes: FlatEntry[] = [
        makeFlatEntry({ node: root, depth: 1 }),
        makeFlatEntry({ node: a, depth: 2 }),
        makeFlatEntry({ node: a1, depth: 3 }),
        makeFlatEntry({ node: b, depth: 2 }),
        makeFlatEntry({ node: b1, depth: 3 }),
      ];
      const data = makeLoadedData({ atlas, flatNodes, complete: true });
      renderReader({ id: "root", data });

      cycleTo(a.id, 1);
      cycleTo(b.id, 1);
      expect(screen.getByTestId(`node-${a1.id}`)).toBeInTheDocument();
      expect(screen.getByTestId(`node-${b1.id}`)).toBeInTheDocument();

      // Collapse a, then collapse b partway through a's exit window.
      cycleTo(a.id, 0);
      expect(screen.getByTestId(`node-${a1.id}`)).toHaveAttribute("data-exiting", "true");
      act(() => vi.advanceTimersByTime(EXIT_MS / 2));
      cycleTo(b.id, 0);

      // a1 must still be mid-fade, not dropped by b's collapse.
      expect(screen.getByTestId(`node-${a1.id}`)).toHaveAttribute("data-exiting", "true");
      expect(screen.getByTestId(`node-${b1.id}`)).toHaveAttribute("data-exiting", "true");

      // a's own timer fires first — only a1 leaves.
      act(() => vi.advanceTimersByTime(EXIT_MS / 2 + 20));
      expect(screen.queryByTestId(`node-${a1.id}`)).toBeNull();
      expect(screen.getByTestId(`node-${b1.id}`)).toHaveAttribute("data-exiting", "true");

      // b's timer then fires on its own schedule.
      act(() => vi.advanceTimersByTime(EXIT_MS / 2 + 20));
      expect(screen.queryByTestId(`node-${b1.id}`)).toBeNull();
    } finally {
      vi.useRealTimers();
      (window as unknown as { matchMedia: unknown }).matchMedia = realMatchMedia;
    }
  });

  it("shift-click reverses the swing, and jumps end-to-end from either extreme", () => {
    const { atlas, flatNodes, a, a1 } = makeCradleTree();
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    renderReader({ id: "root", data });
    const level = () => screen.getByTestId(`node-${a.id}`).getAttribute("data-rung-level");

    // up → middle → shift → back up (undoes the swing rather than continuing).
    cycleTo(a.id, 0);
    fireEvent.click(screen.getByText(`pendulum-${a.id}`));
    expect(level()).toBe("1");
    fireEvent.click(screen.getByText(`reverse-${a.id}`));
    expect(level()).toBe("0");

    // From the bottom end there is no reverse step, so it crosses to the top:
    // rows AND bodies arrive together.
    fireEvent.click(screen.getByText(`reverse-${a.id}`));
    expect(level()).toBe("2");
    expect(screen.getByTestId(`node-${a1.id}`)).toHaveAttribute("data-expanded", "true");

    // down → middle → shift → back down.
    fireEvent.click(screen.getByText(`pendulum-${a.id}`));
    expect(level()).toBe("1");
    fireEvent.click(screen.getByText(`reverse-${a.id}`));
    expect(level()).toBe("2");

    // …and from the top end it crosses straight back to hidden.
    fireEvent.click(screen.getByText(`reverse-${a.id}`));
    expect(level()).toBe("0");
    expect(screen.queryByTestId(`node-${a1.id}`)).toBeNull();
  });

  it("the 0 → 1 swing leaves the clicked doc's own body alone", () => {
    const { atlas, flatNodes, a } = makeCradleTree();
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    renderReader({ id: "root", data });
    cycleTo(a.id, 0);

    // Open a's body by hand, as reading a doc does, then ask to see its
    // children's titles. Revealing structure must not shut what you're reading.
    fireEvent.click(screen.getByText(`toggle-${a.id}`));
    expect(screen.getByTestId(`node-${a.id}`)).toHaveAttribute("data-expanded", "true");
    cycleTo(a.id, 1);
    expect(screen.getByTestId(`node-${a.id}`)).toHaveAttribute("data-expanded", "true");
  });

  it("required #3: reveal-on-nav never forces bodies — a body opened in one branch stays open after navigating elsewhere", () => {
    const { atlas, flatNodes, b } = makeCradleTree();
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    const { rerenderWith } = renderReader({ id: "a", selectedId: "a", data });

    fireEvent.click(screen.getByText(`toggle-${b.id}`));
    expect(screen.getByTestId(`node-${b.id}`)).toHaveAttribute("data-expanded", "true");

    // Navigate to an unrelated doc — the reveal-on-nav effect raises rungs
    // along the new target's ancestor chain but must never touch
    // userToggles/body state.
    rerenderWith({ id: "a1", selectedId: "a1", data });
    expect(screen.getByTestId(`node-${b.id}`)).toHaveAttribute("data-expanded", "true");
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
    // The top-of-forest row still renders normally.
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
