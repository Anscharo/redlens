// @vitest-environment jsdom
// JuniorPane is the split/comparison pane: an ancestor breadcrumb, the selected
// doc, and its descendant slice. We assert the breadcrumb links, the close
// button, descendant rendering, and that Shift-clicking a row re-targets the pane.

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { JuniorPane } from "./JuniorPane";
import { makeNode, makeFlatEntry, makeAtlasBundle, makeLoadedData } from "../../test/fixtures";

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
    const { container } = setup();
    expect(container.querySelector("#junior-split")).not.toBeNull();
    expect(container.querySelector("#junior-child")).not.toBeNull();
    expect(screen.getByText("Child Title")).toBeInTheDocument();
  });

  it("re-targets the pane when a descendant row is Shift-clicked", () => {
    const { container, onShiftNavigate } = setup();
    const childTitle = container.querySelector("#junior-child .atlas-node-title")!;
    fireEvent.click(childTitle, { shiftKey: true });
    expect(onShiftNavigate).toHaveBeenCalledWith("child");
  });
});
