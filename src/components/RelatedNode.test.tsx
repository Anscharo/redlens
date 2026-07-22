// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { RelatedNode } from "./RelatedNode";
import { makeNode } from "../test/fixtures";
import type { AtlasNode } from "../types";

// RelatedNode's checkbox now lives in a self-subscribing RelatedSelectBox that
// reads the selection store directly (so a toggle re-renders only the checkbox,
// not the panel or the reader). Mock the store to capture the actions and drive
// the checked state.
const mocks = vi.hoisted(() => ({
  ids: new Set<string>(),
  toggleDoc: vi.fn(),
  selectSubtree: vi.fn(),
}));
vi.mock("../lib/selection", () => ({
  useSelection: () => ({
    ids: mocks.ids,
    toggleDoc: mocks.toggleDoc,
    selectSubtree: mocks.selectSubtree,
    clear: () => {},
    replace: () => {},
    selectedOnly: false,
    setSelectedOnly: () => {},
    activeCollectionId: null,
    setActiveCollectionId: () => {},
    activeCollectionName: null,
    setActiveCollectionName: () => {},
  }),
}));

const node = makeNode({ id: "rel-1", title: "Related Doc" });
// byParent with no children for the node → collectSubtree yields just [node.id].
const byParent = new Map<string | null, AtlasNode[]>([[null, [node]]]);

beforeEach(() => {
  mocks.ids = new Set<string>();
  mocks.toggleDoc.mockClear();
  mocks.selectSubtree.mockClear();
});
afterEach(cleanup);

describe("RelatedNode selection checkbox", () => {
  it("renders no checkbox when not selectable", () => {
    const { container } = render(<RelatedNode node={node} onNavigate={vi.fn()} />);
    expect(container.querySelector(".atlas-node-select input")).toBeNull();
  });

  it("plain click toggles just this doc (shiftKey false)", () => {
    const { container } = render(
      <RelatedNode node={node} onNavigate={vi.fn()} selectable byParent={byParent} />,
    );
    fireEvent.click(container.querySelector(".atlas-node-select input")!);
    expect(mocks.toggleDoc).toHaveBeenCalledWith(node.id);
    expect(mocks.selectSubtree).not.toHaveBeenCalled();
  });

  it("shift-click requests the subtree (shiftKey true)", () => {
    const { container } = render(
      <RelatedNode node={node} onNavigate={vi.fn()} selectable byParent={byParent} />,
    );
    fireEvent.click(container.querySelector(".atlas-node-select input")!, { shiftKey: true });
    expect(mocks.selectSubtree).toHaveBeenCalledWith(expect.arrayContaining([node.id]));
    expect(mocks.toggleDoc).not.toHaveBeenCalled();
  });

  it("reflects the selection store as the checkbox state", () => {
    mocks.ids = new Set([node.id]);
    const { container } = render(
      <RelatedNode node={node} onNavigate={vi.fn()} selectable byParent={byParent} />,
    );
    expect(container.querySelector<HTMLInputElement>(".atlas-node-select input")!.checked).toBe(true);
  });
});
