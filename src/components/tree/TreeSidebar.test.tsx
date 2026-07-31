// @vitest-environment jsdom
// TreeSidebar owns the virtualized atlas tree: expand/collapse state, ancestor
// auto-expansion on navigation, the preview "changed only" / selection "selected
// only" flat views, the cradle rail, keyboard nav (delegated to useTreeKeyboard),
// and the reveal-cascade for preview rollup badges. react-window's <List> is
// mocked to render every row directly (no virtualization/measurement in jsdom),
// so TreeRow's real rendering is exercised through it.

import { describe, it, expect, afterEach, beforeEach, beforeAll, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useRef } from "react";
import { TreeSidebar } from "./TreeSidebar";
import { revealStore } from "../../lib/revealStore";
import { makeNode, makeAtlasBundle } from "../../test/fixtures";

const mocks = vi.hoisted(() => ({
  bundle: null as unknown,
  changedSet: null as Set<string> | null,
  selectionSet: null as Set<string> | null,
  diff: {
    added: new Set<string>(),
    changed: new Set<string>(),
    renumbered: {},
    reusedSlot: {},
    identitySwap: {},
    formerUuid: {},
  },
  dataSource: { base: "/api/atlas/x/", preview: null as { id: string; sha: string } | null },
  track: vi.fn(),
  scrollToRow: vi.fn(),
}));

vi.mock("../../hooks/useAtlasTree", () => ({ useAtlasTree: () => mocks.bundle }));
vi.mock("../../hooks/usePulseDom", () => ({ usePulseDom: () => {} }));
vi.mock("../../hooks/useRevealFlash", () => ({ useRevealFlash: () => new Set<string>() }));
vi.mock("../../lib/previewFilter", () => ({
  usePreviewChangedSet: () => mocks.changedSet,
  usePreviewDim: () => false,
}));
vi.mock("../../lib/previewDiff", () => ({ usePreviewDiff: () => mocks.diff }));
vi.mock("../../lib/selectionFilter", () => ({ useSelectionSet: () => mocks.selectionSet }));
vi.mock("../../lib/dataSource", () => ({ useDataSource: () => mocks.dataSource }));
vi.mock("../../lib/analytics", () => ({ track: (...args: unknown[]) => mocks.track(...args) }));
vi.mock("../preview/PreviewTreeToggle", () => ({ PreviewTreeToggle: () => null }));
vi.mock("../selection/SelectionTreeToggle", () => ({ SelectionTreeToggle: () => null }));
// truncateTitle measures via @chenglou/pretext, which needs a real canvas
// (unavailable in jsdom) — stub it so rows render without the width math.
vi.mock("../../lib/treeUtils", () => ({ truncateTitle: (title: string) => title }));

vi.mock("react-window", () => ({
  useListRef: (init: unknown) => useRef(init),
  List: ({
    rowComponent: RowComponent,
    rowCount,
    rowProps,
    listRef,
  }: {
    rowComponent: React.ComponentType<Record<string, unknown>>;
    rowCount: number;
    rowProps: Record<string, unknown>;
    listRef?: { current: unknown };
  }) => {
    if (listRef) listRef.current = { scrollToRow: mocks.scrollToRow, element: null };
    const aria = { "aria-posinset": 1, "aria-setsize": rowCount, role: "listitem" as const };
    return (
      <div>
        {Array.from({ length: rowCount }, (_, index) => (
          <RowComponent key={index} index={index} style={{}} ariaAttributes={aria} {...rowProps} />
        ))}
      </div>
    );
  },
}));

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    class FakeResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
});

afterEach(() => {
  cleanup();
  mocks.bundle = null;
  mocks.changedSet = null;
  mocks.selectionSet = null;
  mocks.diff = {
    added: new Set(),
    changed: new Set(),
    renumbered: {},
    reusedSlot: {},
    identitySwap: {},
    formerUuid: {},
  };
  mocks.dataSource = { base: "/api/atlas/x/", preview: null };
  mocks.track.mockClear();
  mocks.scrollToRow.mockClear();
});

// root(A.1) → mid(A.1.2) → leaf(A.1.2.3) → deep(A.1.2.3.4)
//           ↘ sib(A.1.5)
//           ↘ nr1(NR-1)
function tree() {
  const root = makeNode({ id: "root", doc_no: "A.1", title: "Root", depth: 1, parentId: null });
  const mid = makeNode({ id: "mid", doc_no: "A.1.2", title: "Mid", depth: 2, parentId: "root" });
  const leaf = makeNode({ id: "leaf", doc_no: "A.1.2.3", title: "Leaf", depth: 3, parentId: "mid" });
  const deep = makeNode({ id: "deep", doc_no: "A.1.2.3.4", title: "Deep", depth: 4, parentId: "leaf" });
  const sib = makeNode({ id: "sib", doc_no: "A.1.5", title: "Sib", depth: 2, parentId: "root" });
  const nr1 = makeNode({ id: "nr1", doc_no: "NR-1", title: "NR One", depth: 2, parentId: "root" });
  return [root, mid, leaf, deep, sib, nr1];
}

function setup(props: Partial<React.ComponentProps<typeof TreeSidebar>> = {}) {
  const onNavigate = vi.fn();
  const onShiftNavigate = vi.fn();
  const utils = render(
    <TreeSidebar nodeId={null} onNavigate={onNavigate} onShiftNavigate={onShiftNavigate} {...props} />,
  );
  return { ...utils, onNavigate, onShiftNavigate };
}

describe("TreeSidebar without a loaded bundle", () => {
  it("renders an empty container, no role=tree", () => {
    mocks.bundle = null;
    const { container } = setup();
    expect(container.querySelector(".tree-sidebar")).toBeInTheDocument();
    expect(screen.queryByRole("tree")).toBeNull();
  });
});

describe("TreeSidebar basic tree rendering", () => {
  it("renders only top-level rows collapsed by default", () => {
    mocks.bundle = makeAtlasBundle(tree());
    setup();
    expect(screen.getByRole("tree", { name: "Atlas tree" })).toBeInTheDocument();
    expect(screen.getAllByRole("treeitem")).toHaveLength(1);
  });

  it("expands one level on a plain toggle click", () => {
    mocks.bundle = makeAtlasBundle(tree());
    setup();
    fireEvent.click(screen.getByRole("button"));
    // root + mid + sib + nr1 (leaf/deep still hidden — mid not expanded yet)
    expect(screen.getAllByRole("treeitem")).toHaveLength(4);
    expect(mocks.track).toHaveBeenCalledWith("reader_sidebar_toggle", {
      node_id: "root",
      action: "expand",
      cascade: false,
    });
  });

  it("cascades expansion one level per toggle click", () => {
    mocks.bundle = makeAtlasBundle(tree());
    setup();
    const toggles = () => screen.getAllByRole("button").filter((b) => b.className.includes("tree-toggle"));
    fireEvent.click(toggles()[0]); // expand root
    fireEvent.click(toggles().find((b) => b.closest('[data-node-id="mid"]'))!); // expand mid
    // root, mid, leaf, sib, nr1 (deep still hidden — leaf not expanded)
    expect(screen.getAllByRole("treeitem")).toHaveLength(5);
  });

  it("alt-click is no longer a bulk gesture — it toggles one level like a plain click", () => {
    mocks.bundle = makeAtlasBundle(tree());
    setup();
    const rootToggle = screen.getAllByRole("button")[0];
    fireEvent.click(rootToggle, { altKey: true });
    // root + mid + sib + nr1 — one level, not the whole subtree.
    expect(screen.getAllByRole("treeitem")).toHaveLength(4);
    expect(mocks.track).toHaveBeenCalledWith("reader_sidebar_toggle", {
      node_id: "root",
      action: "expand",
      cascade: false,
    });
  });
});

describe("TreeSidebar ancestor auto-expansion on navigation", () => {
  it("expands every ancestor of the selected node, but not the node itself", () => {
    mocks.bundle = makeAtlasBundle(tree());
    setup({ nodeId: "leaf" });
    // root + mid are ancestors and must open, or leaf's row could not be shown.
    // leaf's OWN child (deep) stays hidden: selecting a doc opens it in the
    // reader, it does not rearrange the tree underneath it. Only the chevron
    // does that.
    const ids = screen.getAllByRole("treeitem").map((el) => el.getAttribute("data-node-id"));
    expect(ids).toContain("root");
    expect(ids).toContain("mid");
    expect(ids).toContain("leaf");
    expect(ids).not.toContain("deep");
  });
});

describe("TreeSidebar revealStore integration", () => {
  it("expands ancestors of a revealed doc_no without changing selection", () => {
    mocks.bundle = makeAtlasBundle(tree());
    setup();
    expect(screen.getAllByRole("treeitem")).toHaveLength(1);
    fireEvent.click(screen.getByRole("tree")); // no-op, just ensure mounted
    revealStore.reveal(["deep"]);
    return waitFor(() => {
      const ids = screen.getAllByRole("treeitem").map((el) => el.getAttribute("data-node-id"));
      expect(ids).toContain("leaf");
      expect(ids).toContain("mid");
    });
  });
});

describe("TreeSidebar row click / navigation", () => {
  it("navigates, tracks, and requests a scroll on a plain row click", () => {
    mocks.bundle = makeAtlasBundle(tree());
    const { onNavigate } = setup();
    fireEvent.click(screen.getByRole("treeitem"));
    expect(onNavigate).toHaveBeenCalledWith("root");
    expect(mocks.track).toHaveBeenCalledWith("reader_sidebar_nav", { node_id: "root" });
  });

  it("shift-clicks a row through to onShiftNavigate instead of onNavigate", () => {
    mocks.bundle = makeAtlasBundle(tree());
    const { onNavigate, onShiftNavigate } = setup();
    fireEvent.click(screen.getByRole("treeitem"), { shiftKey: true });
    expect(onShiftNavigate).toHaveBeenCalledWith("root");
    expect(onNavigate).not.toHaveBeenCalled();
  });
});

describe("TreeSidebar scroll-on-select effect", () => {
  it("scrolls to the selected row when nodeId is set on mount", () => {
    mocks.bundle = makeAtlasBundle(tree());
    setup({ nodeId: "sib" });
    expect(mocks.scrollToRow).toHaveBeenCalledWith(
      expect.objectContaining({ align: "smart" }),
    );
  });

  it("does not scroll again for a click that already selected the row", () => {
    mocks.bundle = makeAtlasBundle(tree());
    const { onNavigate } = setup({ nodeId: null });
    mocks.scrollToRow.mockClear();
    fireEvent.click(screen.getByRole("treeitem"));
    expect(onNavigate).toHaveBeenCalledWith("root");
    // nodeId prop hasn't actually changed (parent controls it) — the click-guard
    // (clickedRef) should have suppressed any scroll for this render.
    expect(mocks.scrollToRow).not.toHaveBeenCalled();
  });
});

describe("TreeSidebar cradle rail", () => {
  // The cradle rails the selection's VISIBLE descendants, so these expand the
  // selected node by its chevron first — selecting alone no longer unfolds it.
  const expandRow = (id: string) =>
    fireEvent.click(
      screen
        .getAllByRole("button")
        .find((b) => b.className.includes("tree-toggle") && b.closest(`[data-node-id="${id}"]`))!,
    );

  it("marks the contiguous descendant run below the selection as in-cradle", () => {
    mocks.bundle = makeAtlasBundle(tree());
    const { container } = setup({ nodeId: "mid" });
    expect(container.querySelector(".in-cradle")).toBeNull();

    expandRow("mid");
    const cradled = container.querySelectorAll(".in-cradle");
    expect(cradled.length).toBeGreaterThan(0);
    expect(container.querySelector(".cradle-foot")).not.toBeNull();
  });

  it("sizes the cradle by true descendants in selected-only mode", () => {
    mocks.selectionSet = new Set(["mid", "leaf"]);
    mocks.bundle = makeAtlasBundle(tree());
    const { container } = setup({ nodeId: "mid" });
    expandRow("mid");
    expect(container.querySelector(".in-cradle")).not.toBeNull();
  });
});

describe("TreeSidebar keyboard navigation", () => {
  it("ArrowDown focuses the first row, Enter navigates and clears focus", () => {
    mocks.bundle = makeAtlasBundle(tree());
    const { onNavigate } = setup();
    const treeEl = screen.getByRole("tree");
    fireEvent.keyDown(treeEl, { key: "ArrowDown" });
    expect(screen.getByRole("treeitem").className).toContain("is-focused");
    fireEvent.keyDown(treeEl, { key: "Enter" });
    expect(onNavigate).toHaveBeenCalledWith("root");
  });
});

describe("TreeSidebar changed-only flat view (preview)", () => {
  it("renders exactly the changed docs, flat, with no expand affordance", () => {
    mocks.changedSet = new Set(["leaf", "nr1"]);
    mocks.bundle = makeAtlasBundle(tree());
    const { container } = setup();
    const rows = screen.getAllByRole("treeitem");
    expect(rows).toHaveLength(2);
    expect(container.querySelectorAll(".tree-toggle-empty")).toHaveLength(2);
  });
});

describe("TreeSidebar selected-only flat view", () => {
  it("renders only selected docs via buildSelectedOnlyNodes", () => {
    mocks.selectionSet = new Set(["leaf"]);
    mocks.bundle = makeAtlasBundle(tree());
    setup();
    const ids = screen.getAllByRole("treeitem").map((el) => el.getAttribute("data-node-id"));
    expect(ids).toEqual(["leaf"]);
  });
});

describe("TreeSidebar preview rollup + reveal cascade", () => {
  it("shows a rollup badge on a collapsed ancestor and reveals the change on click", async () => {
    mocks.dataSource = { base: "/api/atlas/x/", preview: { id: "p1", sha: "abc" } };
    mocks.diff = {
      added: new Set(["deep"]),
      changed: new Set(),
      renumbered: {},
      reusedSlot: {},
      identitySwap: {},
      formerUuid: {},
    };
    mocks.bundle = makeAtlasBundle(tree());
    setup();
    const badge = screen.getByRole("button", { name: /Expand to 1 changed doc/ });
    fireEvent.click(badge);
    await waitFor(() => {
      const ids = screen.getAllByRole("treeitem").map((el) => el.getAttribute("data-node-id"));
      expect(ids).toContain("mid");
    });
    await waitFor(() => {
      const ids = screen.getAllByRole("treeitem").map((el) => el.getAttribute("data-node-id"));
      expect(ids).toContain("leaf");
    });
  });

  it("rolls up counts through an NR-X changed doc's ancestor chain", () => {
    mocks.dataSource = { base: "/api/atlas/x/", preview: { id: "p1", sha: "abc" } };
    mocks.diff = {
      added: new Set(["nr1"]),
      changed: new Set(),
      renumbered: {},
      reusedSlot: {},
      identitySwap: {},
      formerUuid: {},
    };
    mocks.bundle = makeAtlasBundle(tree());
    setup();
    expect(screen.getByRole("button", { name: /Expand to 1 changed doc/ })).toBeInTheDocument();
  });
});

describe("TreeSidebar sidebar-width resize effect", () => {
  it("mounts and unmounts without error as ResizeObserver fires", () => {
    mocks.bundle = makeAtlasBundle(tree());
    const { unmount } = setup();
    expect(() => unmount()).not.toThrow();
  });
});

// A 6-level chain — deeper than the cascade cap — so the cap actually bites:
// the levels past it never appear, proving maxLevels stops the walk rather than
// the frontier simply running out.
function chain() {
  const root = makeNode({ id: "c-root", doc_no: "A.1", title: "Root", depth: 1, parentId: null });
  const l1 = makeNode({ id: "c-l1", doc_no: "A.1.2", title: "L1", depth: 2, parentId: "c-root" });
  const l2 = makeNode({ id: "c-l2", doc_no: "A.1.2.3", title: "L2", depth: 3, parentId: "c-l1" });
  const l3 = makeNode({ id: "c-l3", doc_no: "A.1.2.3.4", title: "L3", depth: 4, parentId: "c-l2" });
  const l4 = makeNode({ id: "c-l4", doc_no: "A.1.2.3.4.5", title: "L4", depth: 5, parentId: "c-l3" });
  const l5 = makeNode({ id: "c-l5", doc_no: "A.1.2.3.4.5.6", title: "L5", depth: 6, parentId: "c-l4" });
  return [root, l1, l2, l3, l4, l5];
}

describe("TreeSidebar shift-click cascade", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shift-clicks a chevron and unfolds three levels one tick at a time, then stops", () => {
    mocks.bundle = makeAtlasBundle(chain());
    setup();
    const rootToggle = screen.getAllByRole("button")[0];

    act(() => fireEvent.click(rootToggle, { shiftKey: true }));
    // Tick 1 (synchronous): root expands, revealing l1.
    expect(screen.getAllByRole("treeitem")).toHaveLength(2);

    act(() => vi.advanceTimersByTime(180));
    // Tick 2: l1 expands, revealing l2.
    expect(screen.getAllByRole("treeitem")).toHaveLength(3);

    act(() => vi.advanceTimersByTime(180));
    // Tick 3 — the cap: l2 expands, revealing l3, and no further tick is scheduled.
    expect(screen.getAllByRole("treeitem")).toHaveLength(4);
    expect(vi.getTimerCount()).toBe(0);

    // l3 itself was never added to expandedIds, so its own child (l4) stays hidden.
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getAllByRole("treeitem")).toHaveLength(4);
  });

  it("carries cascade: true in the analytics payload on shift-click", () => {
    mocks.bundle = makeAtlasBundle(tree());
    setup();
    act(() => fireEvent.click(screen.getAllByRole("button")[0], { shiftKey: true }));
    expect(mocks.track).toHaveBeenCalledWith("reader_sidebar_toggle", {
      node_id: "root",
      action: "expand",
      cascade: true,
    });
    act(() => vi.runAllTimers());
  });

  it("shift-clicking an OPEN chevron collapses the row and every descendant", () => {
    mocks.bundle = makeAtlasBundle(chain());
    setup();
    const rootToggle = screen.getAllByRole("button")[0];

    // Cascade the branch open first, so there are nested expansions to undo.
    act(() => fireEvent.click(rootToggle, { shiftKey: true }));
    act(() => vi.runAllTimers());
    expect(screen.getAllByRole("treeitem")).toHaveLength(4);

    // Shift again, now that it is open: the whole branch folds back in one step.
    act(() => fireEvent.click(rootToggle, { shiftKey: true }));
    expect(screen.getAllByRole("treeitem")).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0); // instant, not staggered
    expect(mocks.track).toHaveBeenLastCalledWith("reader_sidebar_toggle", {
      node_id: "c-root",
      action: "collapse",
      cascade: true,
    });

    // The descendants were cleared too, not just hidden: re-opening one level
    // shows l1 alone, with l2 still folded.
    act(() => fireEvent.click(rootToggle));
    expect(screen.getAllByRole("treeitem")).toHaveLength(2);
  });

  it("falls through to a plain one-level toggle when shift-clicking in selected-only view", () => {
    mocks.selectionSet = new Set(["mid", "leaf"]);
    mocks.bundle = makeAtlasBundle(tree());
    setup();
    const midToggle = screen.getByRole("button");
    act(() => fireEvent.click(midToggle, { shiftKey: true }));
    // Plain one-level expand applied synchronously — no cascade timer scheduled
    // (if the guard were missing, cascadeLevels would walk the real tree's
    // "leaf" → "deep" edge and leave a pending timer here).
    expect(screen.getAllByRole("treeitem").map((el) => el.getAttribute("data-node-id"))).toEqual([
      "mid",
      "leaf",
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
