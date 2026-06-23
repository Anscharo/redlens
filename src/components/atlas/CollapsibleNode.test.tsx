// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { CollapsibleNode } from "./CollapsibleNode";
import { AtlasActionsContext } from "./AtlasActionsContext";
import { type FlatEntry } from "../../lib/atlasHelpers";
import { type AtlasNode } from "../../types";

afterEach(cleanup);

const baseNode: AtlasNode = {
  id: "uuid-test",
  doc_no: "A.1.2",
  title: "Test Node",
  type: "Core",
  depth: 3,
  parentId: null,
  content: "Body content",
  contentHash: "",
  order: 0,
  addressRefs: [],
};

const baseEntry: FlatEntry = {
  node: baseNode,
  depth: 3,
  color: "var(--depth-3)",
  hasContent: true,
};

interface Overrides {
  isSelected?: boolean;
  isExpanded?: boolean;
  hasChildren?: boolean;
  isSubtreeExpanded?: boolean;
  hiddenCount?: number;
  withExpandAll?: boolean;
}

function setup(overrides: Overrides = {}) {
  const onNavigate = vi.fn();
  const onToggle = vi.fn();
  const onShiftNavigate = vi.fn();
  const onExpandChildren = vi.fn();
  const expandAll = vi.fn();
  const utils = render(
    <AtlasActionsContext.Provider
      value={{
        navigate: onNavigate,
        toggle: onToggle,
        splitNavigate: onShiftNavigate,
        expandAll: overrides.withExpandAll ? expandAll : undefined,
      }}
    >
      <CollapsibleNode
        entry={baseEntry}
        isSelected={overrides.isSelected ?? false}
        isExpanded={overrides.isExpanded ?? false}
        hasChildren={overrides.hasChildren ?? false}
        isSubtreeExpanded={overrides.isSubtreeExpanded ?? false}
        hiddenCount={overrides.hiddenCount ?? 0}
        onExpandChildren={onExpandChildren}
      />
    </AtlasActionsContext.Provider>,
  );
  return { ...utils, onNavigate, onToggle, onShiftNavigate, onExpandChildren, expandAll };
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
  it("shows no hidden affordance when hiddenCount is 0", () => {
    const { container } = setup({ hiddenCount: 0 });
    expect(container.querySelector(".view-children-affordance")).toBeNull();
    expect(container.querySelector("[data-has-hidden]")).toBeNull();
  });

  it("renders the 'N hidden' affordance and the data-has-hidden marker", () => {
    const { container, getByText } = setup({ hiddenCount: 3 });
    expect(getByText("3 hidden")).toBeTruthy();
    expect(container.querySelector('[data-has-hidden="true"]')).not.toBeNull();
  });

  it("calls onExpandChildren without selecting/toggling the row (stopPropagation)", () => {
    const { getByText, onExpandChildren, onNavigate, onToggle } = setup({ hiddenCount: 2 });
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
    const { container, expandAll } = setup({
      hasChildren: true,
      withExpandAll: true,
      isSubtreeExpanded: false,
    });
    fireEvent.click(container.querySelector(".atlas-node-expand-all")!);
    expect(expandAll).toHaveBeenCalledWith(baseNode.id, true);
  });
});
