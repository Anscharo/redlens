// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { CollapsibleNode } from "./CollapsibleNode";
import { AtlasActionsContext } from "./AtlasActionsContext";
import { makeNode, makeFlatEntry } from "../../test/fixtures";
import type { SubtreeVisualState } from "./subtreeState";

afterEach(cleanup);

const baseNode = makeNode({ id: "uuid-test" });
const baseEntry = makeFlatEntry({ node: baseNode });

interface Overrides {
  isSelected?: boolean;
  isExpanded?: boolean;
  hasChildren?: boolean;
  subtreeState?: SubtreeVisualState;
  hasExplicitHiddenSubtree?: boolean;
  gatedCount?: number;
  withExpandAll?: boolean;
}

function setup(overrides: Overrides = {}) {
  const onNavigate = vi.fn();
  const onToggle = vi.fn();
  const onShiftNavigate = vi.fn();
  const onExpandChildren = vi.fn();
  const expandAll = vi.fn();
  const hideSubtree = vi.fn();
  const setSubtreeVisualState = vi.fn();
  const utils = render(
    <AtlasActionsContext.Provider
      value={{
        navigate: onNavigate,
        toggle: onToggle,
        splitNavigate: onShiftNavigate,
        expandAll: overrides.withExpandAll ? expandAll : undefined,
        hideSubtree,
        setSubtreeVisualState: overrides.withExpandAll ? setSubtreeVisualState : undefined,
      }}
    >
      <CollapsibleNode
        entry={baseEntry}
        isSelected={overrides.isSelected ?? false}
        isExpanded={overrides.isExpanded ?? false}
        hasChildren={overrides.hasChildren ?? false}
        subtreeState={overrides.subtreeState ?? "closed"}
        hasExplicitHiddenSubtree={overrides.hasExplicitHiddenSubtree ?? false}
        gatedCount={overrides.gatedCount ?? 0}
        onExpandChildren={onExpandChildren}
      />
    </AtlasActionsContext.Provider>,
  );
  return { ...utils, onNavigate, onToggle, onShiftNavigate, onExpandChildren, expandAll, hideSubtree, setSubtreeVisualState };
}

describe("CollapsibleNode click behaviour", () => {
  it("clicking the title when not selected calls onNavigate once and does not toggle", () => {
    const { container, onNavigate, onToggle } = setup({ isSelected: false });
    const heading = container.querySelector(".atlas-node-title")!;
    fireEvent.mouseDown(heading, { clientX: 50, clientY: 50 });
    fireEvent.click(heading, { clientX: 50, clientY: 50 });
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith(baseNode.id);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("clicking inside the body when selected + expanded does not navigate or toggle", () => {
    const { container, onNavigate, onToggle } = setup({ isSelected: true, isExpanded: true });
    const body = container.querySelector(".atlas-node-body")!;
    fireEvent.mouseDown(body, { clientX: 50, clientY: 50 });
    fireEvent.click(body, { clientX: 50, clientY: 50 });
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("clicking the title bar when selected with content calls onToggle", () => {
    const { container, onToggle } = setup({ isSelected: true });
    const heading = container.querySelector(".atlas-node-title")!;
    fireEvent.mouseDown(heading, { clientX: 50, clientY: 50 });
    fireEvent.click(heading, { clientX: 50, clientY: 50 });
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith(baseNode.id);
  });

  it("does not navigate when mouse moves past the drag threshold between mousedown and click", () => {
    const { container, onNavigate, onToggle } = setup({ isSelected: false });
    const heading = container.querySelector(".atlas-node-title")!;
    fireEvent.mouseDown(heading, { clientX: 100, clientY: 100 });
    fireEvent.click(heading, { clientX: 110, clientY: 100 });
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("navigates when mouseDown and click land at the same position", () => {
    const { container, onNavigate } = setup({ isSelected: false });
    const heading = container.querySelector(".atlas-node-title")!;
    fireEvent.mouseDown(heading, { clientX: 100, clientY: 100 });
    fireEvent.click(heading, { clientX: 100, clientY: 100 });
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith(baseNode.id);
  });
});

describe("CollapsibleNode depth-6 affordance", () => {
  it("shows no hidden affordance when gatedCount is 0", () => {
    const { container } = setup({ gatedCount: 0 });
    expect(container.querySelector(".view-children-affordance")).toBeNull();
    expect(container.querySelector("[data-has-hidden]")).toBeNull();
  });

  it("renders the 'N hidden' affordance and the data-has-hidden marker", () => {
    const { container, getByText } = setup({ gatedCount: 3 });
    expect(getByText("3 hidden")).toBeTruthy();
    expect(container.querySelector('[data-has-hidden="true"]')).not.toBeNull();
  });

  it("calls onExpandChildren without selecting/toggling the row (stopPropagation)", () => {
    const { getByText, onExpandChildren, onNavigate, onToggle } = setup({ gatedCount: 2 });
    fireEvent.click(getByText("2 hidden"));
    expect(onExpandChildren).toHaveBeenCalledWith(baseNode.id);
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onToggle).not.toHaveBeenCalled();
  });
});

describe("CollapsibleNode expand-all toggle", () => {
  it("hides the expand-all button when the node has no children", () => {
    const { container } = setup({ hasChildren: false, withExpandAll: true });
    expect(container.querySelector(".atlas-node-expand-all")).toBeNull();
  });

  it("shows the expand-all button only when there are children and an expandAll action", () => {
    const { container } = setup({ hasChildren: true, withExpandAll: true });
    expect(container.querySelector(".atlas-node-expand-all")).not.toBeNull();
  });

  it("calls expandAll with the expand intent based on current subtree state", () => {
    const { container, setSubtreeVisualState } = setup({
      hasChildren: true,
      withExpandAll: true,
      subtreeState: "closed",
    });
    fireEvent.click(container.querySelector(".atlas-node-expand-all")!);
    expect(setSubtreeVisualState).toHaveBeenCalledWith(baseNode.id, "open");
  });

  it("points the expand-all button up when the subtree is hidden", () => {
    const { container } = setup({
      hasChildren: true,
      withExpandAll: true,
      subtreeState: "hidden",
    });
    expect(container.querySelector(".atlas-node-expand-all")?.classList.contains("is-hidden")).toBe(true);
  });

  it("expands a hidden subtree on normal click", () => {
    const { container, setSubtreeVisualState } = setup({
      hasChildren: true,
      withExpandAll: true,
      subtreeState: "hidden",
    });
    fireEvent.click(container.querySelector(".atlas-node-expand-all")!);
    expect(setSubtreeVisualState).toHaveBeenCalledWith(baseNode.id, "open");
  });

  it("restores a hidden subtree on normal click when it has an explicit snapshot", () => {
    const { container, setSubtreeVisualState } = setup({
      hasChildren: true,
      withExpandAll: true,
      subtreeState: "hidden",
      hasExplicitHiddenSubtree: true,
    });
    fireEvent.click(container.querySelector(".atlas-node-expand-all")!);
    expect(setSubtreeVisualState).toHaveBeenCalledWith(baseNode.id, "open", { restore: true });
  });

  it("expands a depth-gated hidden subtree when no explicit snapshot exists", () => {
    const { container, setSubtreeVisualState } = setup({
      hasChildren: true,
      withExpandAll: true,
      subtreeState: "hidden",
      hasExplicitHiddenSubtree: false,
    });
    fireEvent.click(container.querySelector(".atlas-node-expand-all")!);
    expect(setSubtreeVisualState).toHaveBeenCalledWith(baseNode.id, "open");
  });

  it("shift-click hides the subtree", () => {
    const { container, setSubtreeVisualState } = setup({
      hasChildren: true,
      withExpandAll: true,
    });
    fireEvent.click(container.querySelector(".atlas-node-expand-all")!, { shiftKey: true });
    expect(setSubtreeVisualState).toHaveBeenCalledWith(baseNode.id, "hidden");
  });

  it("runs the compositor feedback and defers the commit two frames when the button can animate", () => {
    // jsdom has no Element.animate — stub it so the WAAPI feedback path runs
    // instead of the plain synchronous fallback, and make rAF resolve inline so
    // the deferred rAF(rAF(commit)) fires within the test.
    const cancel = vi.fn();
    const animate = vi
      .fn()
      .mockReturnValue({ cancel });
    (HTMLElement.prototype as unknown as { animate: (...a: unknown[]) => unknown }).animate = animate;
    const rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      });

    const { container, setSubtreeVisualState } = setup({
      hasChildren: true,
      withExpandAll: true,
      subtreeState: "closed",
    });
    fireEvent.click(container.querySelector(".atlas-node-expand-all")!);

    // The chevron animation (spin + pulse) ran, and the heavy state commit still
    // landed once the two deferred frames resolved.
    expect(animate).toHaveBeenCalled();
    expect(setSubtreeVisualState).toHaveBeenCalledWith(baseNode.id, "open");

    rafSpy.mockRestore();
    delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
  });

});

describe("CollapsibleNode keyboard interaction", () => {
  it("Enter navigates when the row is not selected", () => {
    const { container, onNavigate, onToggle } = setup({ isSelected: false });
    fireEvent.keyDown(container.querySelector(".atlas-node")!, { key: "Enter" });
    expect(onNavigate).toHaveBeenCalledWith(baseNode.id);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("Space toggles when the row is selected and has content", () => {
    const { container, onToggle, onNavigate } = setup({ isSelected: true });
    fireEvent.keyDown(container.querySelector(".atlas-node")!, { key: " " });
    expect(onToggle).toHaveBeenCalledWith(baseNode.id);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("ignores other keys", () => {
    const { container, onToggle, onNavigate } = setup({ isSelected: true });
    fireEvent.keyDown(container.querySelector(".atlas-node")!, { key: "Tab" });
    expect(onToggle).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
  });
});

describe("CollapsibleNode NR-X doc numbers", () => {
  it("renders an NR-X token via the NR chiclet layout instead of dot-split parts", () => {
    const nrNode = makeNode({ id: "uuid-nr", doc_no: "NR-42" });
    const nrEntry = makeFlatEntry({ node: nrNode });
    const onNavigate = vi.fn();
    const { container } = render(
      <AtlasActionsContext.Provider
        value={{ navigate: onNavigate, toggle: vi.fn(), splitNavigate: vi.fn() }}
      >
        <CollapsibleNode entry={nrEntry} isSelected={false} isExpanded={false} />
      </AtlasActionsContext.Provider>,
    );
    const chiclets = container.querySelectorAll(".atlas-chiclet");
    // "NR-42" → chars ["N","R","-","4","2"], not split on "." (which would be a
    // single one-part token since there's no dot).
    expect(chiclets.length).toBe(5);
    expect(Array.from(chiclets).map((c) => c.textContent).join("")).toBe("NR-42");
  });
});
