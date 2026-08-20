// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { SearchResultSelectBox } from "./SearchResultSelectBox";

// Mock the selection store to capture toggleDoc and drive the checked state.
const mocks = vi.hoisted(() => ({ toggleDoc: vi.fn(), ids: new Set<string>() }));
vi.mock("@/lib/selection", () => ({
  useSelection: () => ({
    ids: mocks.ids,
    toggleDoc: mocks.toggleDoc,
    selectSubtree: () => {},
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

afterEach(() => {
  cleanup();
  mocks.toggleDoc.mockClear();
  mocks.ids = new Set<string>();
});

function renderBox() {
  const utils = render(<SearchResultSelectBox nodeId="uuid-sr" title="Some Doc" />);
  const checkbox = utils.container.querySelector<HTMLInputElement>(".atlas-node-select input")!;
  return { ...utils, checkbox };
}

describe("SearchResultSelectBox", () => {
  it("clicking toggles this doc into the selection", () => {
    const { checkbox } = renderBox();
    fireEvent.click(checkbox);
    expect(mocks.toggleDoc).toHaveBeenCalledWith("uuid-sr");
  });

  it("reflects the current selection membership", () => {
    mocks.ids = new Set(["uuid-sr"]);
    const { checkbox } = renderBox();
    expect(checkbox.checked).toBe(true);
  });
});
