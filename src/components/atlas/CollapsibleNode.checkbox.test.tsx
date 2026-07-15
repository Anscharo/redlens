// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { CollapsibleNode } from "./CollapsibleNode";
import { AtlasActionsContext } from "./AtlasActionsContext";
import { makeNode, makeFlatEntry } from "../../test/fixtures";

// The selection checkbox only renders when selection mode is on, so mock the
// selection store to force it on and capture toggleDoc. selectSubtree reaches
// the checkbox through AtlasActionsContext (the reader provides it), so it's
// injected via the provider below, not the store.
const mocks = vi.hoisted(() => ({ toggleDoc: vi.fn() }));
vi.mock("../../lib/selection", () => ({
  useSelection: () => ({
    ids: new Set<string>(),
    selectionMode: true,
    setSelectionMode: () => {},
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
});

const node = makeNode({ id: "uuid-cb" });
const entry = makeFlatEntry({ node });

function renderCheckbox() {
  const selectSubtree = vi.fn();
  const utils = render(
    <AtlasActionsContext.Provider
      value={{ navigate: vi.fn(), toggle: vi.fn(), splitNavigate: vi.fn(), selectSubtree }}
    >
      <CollapsibleNode entry={entry} isSelected={false} isExpanded={false} />
    </AtlasActionsContext.Provider>,
  );
  const checkbox = utils.container.querySelector<HTMLInputElement>(".atlas-node-select input")!;
  return { ...utils, checkbox, selectSubtree };
}

describe("selection checkbox shift-click", () => {
  it("plain click toggles only this doc", () => {
    const { checkbox, selectSubtree } = renderCheckbox();
    fireEvent.click(checkbox);
    expect(mocks.toggleDoc).toHaveBeenCalledWith(node.id);
    expect(selectSubtree).not.toHaveBeenCalled();
  });

  it("shift-click selects this doc + all descendants", () => {
    const { checkbox, selectSubtree } = renderCheckbox();
    fireEvent.click(checkbox, { shiftKey: true });
    expect(selectSubtree).toHaveBeenCalledWith(node.id);
    expect(mocks.toggleDoc).not.toHaveBeenCalled();
  });
});
