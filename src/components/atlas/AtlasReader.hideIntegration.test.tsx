// @vitest-environment jsdom
// Integration test for the subtree-hide flow using the REAL CollapsibleNode
// (AtlasReader.test.tsx stubs it, which can mask a rendering-level bug). Drives
// the actual » (expand-all) button with a shift-click and asserts the branch's
// descendants really leave the DOM — reproducing the reported "says N hidden but
// the rows are still rendered" bug if it exists.

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { AtlasReader } from "./AtlasReader";
import { AtlasActionsContext } from "./AtlasActionsContext";
import { makeNode, makeFlatEntry, makeAtlasBundle, makeLoadedData } from "../../test/fixtures";
import { flattenTree } from "../../lib/atlasHelpers";
import type { FlatEntry } from "../../lib/atlasHelpers";

vi.mock("../../lib/previewFilter", () => ({
  usePreviewChangedSet: () => null,
  usePreviewDim: () => false,
}));
vi.mock("../../lib/selectionFilter", () => ({ useSelectionSet: () => null }));
vi.mock("../../lib/selection", () => ({
  useSelection: () => ({
    ids: new Set<string>(),
    toggleDoc: vi.fn(),
    selectSubtree: vi.fn(),
    clear: vi.fn(),
    replace: vi.fn(),
    selectedOnly: false,
    setSelectedOnly: vi.fn(),
    activeCollectionId: null,
    setActiveCollectionId: vi.fn(),
    activeCollectionName: null,
    setActiveCollectionName: vi.fn(),
  }),
}));
vi.mock("../../hooks/useExpandingAttr", () => ({ useExpandingAttr: () => () => {} }));
vi.mock("./useAtlasScroll", () => ({ useAtlasScroll: () => {} }));

afterEach(cleanup);

function makeWideTree(childCount: number) {
  const root = makeNode({ id: "root", doc_no: "A", parentId: null });
  const a = makeNode({ id: "a", doc_no: "A.1", parentId: "root" });
  const kids = Array.from({ length: childCount }, (_, i) =>
    makeNode({ id: `k${i}`, doc_no: `A.1.${i + 1}`, parentId: "a" }),
  );
  const atlas = makeAtlasBundle([root, a, ...kids]);
  const flatNodes: FlatEntry[] = [
    makeFlatEntry({ node: root, depth: 1 }),
    makeFlatEntry({ node: a, depth: 2 }),
    ...kids.map((node) => makeFlatEntry({ node, depth: 3 })),
  ];
  return { atlas, flatNodes, root, a, kids };
}

function renderReader(id: string, selectedId: string | null, data: ReturnType<typeof makeLoadedData>) {
  return render(
    <AtlasActionsContext.Provider value={{ navigate: vi.fn(), toggle: vi.fn(), splitNavigate: vi.fn() }}>
      <AtlasReader id={id} selectedId={selectedId} splitId={null} onSplitChange={vi.fn()} data={data} />
    </AtlasActionsContext.Provider>,
  );
}

describe("AtlasReader real-component shift-hide", () => {
  it("shift-clicking the » control hides every descendant row (not just the count)", () => {
    const { atlas, flatNodes, kids } = makeWideTree(6);
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    const { container } = renderReader("root", null, data);

    // all six children render initially
    for (const k of kids) expect(container.querySelector(`#${k.id}`)).not.toBeNull();

    // shift-click the double-chevron on `a`
    const expandAllBtn = container.querySelector(`#a .atlas-node-expand-all`);
    expect(expandAllBtn).not.toBeNull();
    fireEvent.click(expandAllBtn!, { shiftKey: true });

    // the row advertises the hidden count …
    expect(container.querySelector("#a")?.textContent).toContain("6 hidden");
    // … and every descendant row is actually gone from the DOM
    for (const k of kids) expect(container.querySelector(`#${k.id}`)).toBeNull();
  });

  // Reproduces the reported bug: a row can be indented as if it were nested
  // under the hidden node (its doc-number depth is deeper) while its parentId
  // was reparented above that node — exactly what the heading-level-6 cap does
  // to deeply-numbered docs. The reader indents by realDepth (doc number) but
  // hides by parentId, so the row stays on screen even though it visually
  // belongs to the branch that now says "N hidden".
  // Hiding keys off the visual (depth-span) subtree, so a deeply-numbered row
  // reparented above the hidden node by the heading-level-6 cap — but indented
  // as if nested under it — is hidden along with the rest of the branch.
  it("hides rows that look nested under the branch even when parentId was reparented by the depth cap", () => {
    // R = "A.1". Six real children A.1.1…A.1.6 (parentId R). One deeply-numbered
    // doc A.1.7.1 whose parentId is the ROOT (as the cap would leave it) — it
    // indents under R's block but is not in R's parentId subtree.
    const root = makeNode({ id: "root", doc_no: "A", parentId: null });
    const R = makeNode({ id: "R", doc_no: "A.1", parentId: "root" });
    const kids = Array.from({ length: 6 }, (_, i) =>
      makeNode({ id: `k${i}`, doc_no: `A.1.${i + 1}`, parentId: "R" }),
    );
    const ghost = makeNode({ id: "ghost", doc_no: "A.1.7.1", parentId: "root" });
    const atlas = makeAtlasBundle([root, R, ...kids, ghost]);
    // Build the flat list the way the real app does, so depths come from the
    // doc numbers (ghost lands at a deeper indent than R's own children).
    const data = makeLoadedData({ atlas, flatNodes: flattenTree(atlas.byParent), complete: true });
    const { container } = renderReader("root", null, data);

    expect(container.querySelector("#ghost")).not.toBeNull();

    // shift-hide R
    fireEvent.click(container.querySelector(`#R .atlas-node-expand-all`)!, { shiftKey: true });

    // The six real children are gone …
    for (const k of kids) expect(container.querySelector(`#${k.id}`)).toBeNull();
    // … the deeply-numbered row that visually belongs to R's block is hidden too …
    expect(container.querySelector("#ghost")).toBeNull();
    // … and the count reflects the whole visual span (6 children + the ghost = 7),
    // so "N hidden" matches exactly what left the screen.
    expect(container.querySelector("#R")?.textContent).toContain("7 hidden");
  });
});
