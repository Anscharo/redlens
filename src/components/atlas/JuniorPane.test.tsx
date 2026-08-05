// @vitest-environment jsdom
// JuniorPane is the split/comparison pane: an ancestor breadcrumb, the selected
// doc, and its descendant slice. We assert the breadcrumb links, the close
// button, descendant rendering, and that Shift-clicking a row re-targets the pane.

import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { JuniorPane } from "./JuniorPane";
import { makeNode, makeFlatEntry, makeAtlasBundle, makeLoadedData } from "../../test/fixtures";

// jsdom has no ResizeObserver; useSplitHeight watches the content box with one
// to size the pane to a childless doc. Nothing here asserts on the measurement
// (jsdom reports every box as 0), so an inert stub is enough to let it mount.
beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    class FakeResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
});

// root(A.1) → mid(A.1.2) → split(A.1.2.3) → child(A.1.2.3.1)
function data() {
  const root = makeNode({ id: "root", doc_no: "A.1", title: "Root Title", depth: 1, parentId: null });
  const mid = makeNode({ id: "mid", doc_no: "A.1.2", title: "Mid Title", depth: 2, parentId: "root" });
  const split = makeNode({ id: "split", doc_no: "A.1.2.3", title: "Split Title", depth: 3, parentId: "mid" });
  const child = makeNode({ id: "child", doc_no: "A.1.2.3.1", title: "Child Title", depth: 4, parentId: "split" });
  const nodes = [root, mid, split, child];
  return makeLoadedData({
    atlas: makeAtlasBundle(nodes),
    flatNodes: nodes.map((node) => makeFlatEntry({ node, depth: node.depth })),
  });
}

function setup() {
  const onShiftNavigate = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <JuniorPane splitId="split" data={data()} onShiftNavigate={onShiftNavigate} onClose={onClose} />,
  );
  return { ...utils, onShiftNavigate, onClose };
}

afterEach(cleanup);

describe("JuniorPane breadcrumb", () => {
  it("renders the ancestor chain as links", () => {
    setup();
    expect(screen.getByRole("link", { name: "Root Title" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Mid Title" })).toBeInTheDocument();
  });

  it("navigates to an ancestor on breadcrumb click", () => {
    const { onShiftNavigate } = setup();
    fireEvent.click(screen.getByRole("link", { name: "Mid Title" }));
    expect(onShiftNavigate).toHaveBeenCalledWith("mid");
  });

  it("calls onClose when the close button is clicked", () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByText("✕"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("JuniorPane descendant slice", () => {
  it("renders the selected doc and its descendants", () => {
    setup();
    // Both render as headings in the slice (the split title also appears in the
    // breadcrumb as a span, so scope to the heading role to stay unambiguous).
    expect(screen.getByRole("heading", { name: "Split Title" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Child Title" })).toBeInTheDocument();
  });

  it("re-targets the pane when a descendant row is Shift-clicked", () => {
    const { onShiftNavigate } = setup();
    fireEvent.click(screen.getByRole("heading", { name: "Child Title" }), { shiftKey: true });
    expect(onShiftNavigate).toHaveBeenCalledWith("child");
  });

  it("toggles the split node's own body collapsed/expanded on title click", () => {
    const { container } = setup();
    // The split node is the only selected (isSelected) entry, so it's the only
    // one whose title-bar click can toggle (vs. navigate) — see CollapsibleNode.
    expect(container.querySelector(".atlas-node-body")).not.toBeNull();
    const splitHeading = screen.getByRole("heading", { name: "Split Title" });
    fireEvent.mouseDown(splitHeading, { clientX: 10, clientY: 10 });
    fireEvent.click(splitHeading, { clientX: 10, clientY: 10 });
    expect(container.querySelector(".atlas-node-body")).toBeNull();
  });
});

// R2: the selected root's position:sticky (index.css .atlas-node.is-selected)
// is bounded by the nearest .selection-group ancestor. AtlasReader supplies
// that wrapper; JuniorPane rendered no such wrapper at all, so the sticky
// root's containing block was the whole pane — a long-bodied root could
// occlude every descendant at any scroll position. Assert the wrapper exists
// and spans exactly the selected root + its descendants (not the breadcrumb
// note above, nor the bottom fill/note below).
describe("JuniorPane selection-group wrapper (R2)", () => {
  it("wraps the selected root and its descendants in a selection-group", () => {
    const { container } = setup();
    const group = container.querySelector(".selection-group");
    expect(group).not.toBeNull();
    const splitHeading = screen.getByRole("heading", { name: "Split Title" });
    const childHeading = screen.getByRole("heading", { name: "Child Title" });
    expect(group!.contains(splitHeading)).toBe(true);
    expect(group!.contains(childHeading)).toBe(true);
    // The ancestor breadcrumb note sits above the pane's own header bar, not
    // inside the group.
    expect(group!.textContent).not.toContain("SplitView only renders");
  });

  it("still applies the is-selected marker (red bar + tint) to the root inside the group", () => {
    const { container } = setup();
    const group = container.querySelector(".selection-group")!;
    const selected = group.querySelector(".atlas-node.is-selected");
    expect(selected).not.toBeNull();
    // Exactly one selected row (the split root) — its descendant isn't also selected.
    expect(group.querySelectorAll(".atlas-node.is-selected")).toHaveLength(1);
  });

  it("renders no selection-group for an unknown splitId (nothing to bound)", () => {
    const onShiftNavigate = vi.fn();
    const { container } = render(
      <JuniorPane splitId="missing" data={data()} onShiftNavigate={onShiftNavigate} onClose={() => {}} />,
    );
    expect(container.querySelector(".selection-group")).toBeNull();
  });
});

describe("JuniorPane with an unknown splitId", () => {
  it("renders nothing above and a bare 'no more descendants' note, without crashing", () => {
    const onShiftNavigate = vi.fn();
    const onClose = vi.fn();
    render(
      <JuniorPane splitId="missing" data={data()} onShiftNavigate={onShiftNavigate} onClose={onClose} />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(document.body.textContent).toContain("no more descendants of");
  });
});

describe("JuniorPane 'view all descendants' affordance", () => {
  it("shows the fill button beyond the depth limit and reveals deeper descendants on click", () => {
    // split(depth1) → d2 → d3 → d4 → d5 → d6 → d7 (maxDepth = 1+6 = 7, still shown)
    // → d8 (beyond maxDepth — hidden until "view all descendants" is clicked).
    const split = makeNode({ id: "split", doc_no: "A.1", title: "Split Title", depth: 1, parentId: null });
    let parentId = "split";
    const chain = [split];
    for (let depth = 2; depth <= 8; depth++) {
      const n = makeNode({ id: `d${depth}`, doc_no: `A.1.${depth}`, title: `D${depth} Title`, depth, parentId });
      chain.push(n);
      parentId = n.id;
    }
    const loaded = makeLoadedData({
      atlas: makeAtlasBundle(chain),
      flatNodes: chain.map((node) => makeFlatEntry({ node, depth: node.depth })),
    });
    const onShiftNavigate = vi.fn();
    render(<JuniorPane splitId="split" data={loaded} onShiftNavigate={onShiftNavigate} onClose={() => {}} />);

    expect(screen.getByRole("heading", { name: "D7 Title" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "D8 Title" })).toBeNull();
    const fillButton = screen.getByRole("button", { name: /view all descendants of A\.1/ });

    fireEvent.click(fillButton);

    expect(screen.getByRole("heading", { name: "D8 Title" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /view all descendants of A\.1/ })).toBeNull();
    expect(screen.getByText("no more descendants of A.1 to view")).toBeInTheDocument();
  });
});
