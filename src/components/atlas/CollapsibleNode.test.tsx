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
}

function setup(overrides: Overrides = {}) {
  const onNavigate = vi.fn();
  const onToggle = vi.fn();
  const onShiftNavigate = vi.fn();
  const utils = render(
    <AtlasActionsContext.Provider value={{ navigate: onNavigate, toggle: onToggle, splitNavigate: onShiftNavigate }}>
      <CollapsibleNode
        entry={baseEntry}
        isSelected={overrides.isSelected ?? false}
        isExpanded={overrides.isExpanded ?? false}
      />
    </AtlasActionsContext.Provider>,
  );
  return { ...utils, onNavigate, onToggle, onShiftNavigate };
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
