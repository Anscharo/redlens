// @vitest-environment jsdom
// Integration test for the pendulum-collapse flow using the REAL CollapsibleNode
// (AtlasReader.test.tsx stubs it, which can mask a rendering-level bug). Drives
// the actual » (pendulum) button with real clicks and asserts the branch's
// descendants really leave the DOM — reproducing the reported "says N hidden but
// the rows are still rendered" bug if it exists.
//
// jsdom has no Element.animate, so the pendulum's doPendulum() takes the
// synchronous `else commit()` fallback path — fireEvent.click commits inline,
// no rAF/animation stubbing needed here (contrast CollapsibleNode.test.tsx's
// WAAPI-scaffolding test, which stubs animate deliberately).

import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { AtlasReader } from "./AtlasReader";
import { AtlasActionsContext } from "./AtlasActionsContext";
import { makeNode, makeFlatEntry, makeAtlasBundle, makeLoadedData } from "../../test/fixtures";
import { flattenTree } from "@/lib/atlasHelpers";
import type { FlatEntry } from "@/lib/atlasHelpers";

// The exit fade keeps collapsing rows mounted for EXIT_MS. These suites assert
// collapse SEMANTICS (which rows end up hidden), not the transient, so report
// reduced motion by default — markExiting skips entirely then, and the DOM
// settles synchronously. The fade has its own dedicated test, which opts in.
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }),
  });
});

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

// Clicks a branch's real » button down from the post-nav default of rung 1
// back to rung 0 — the pendulum swings 1→2→1→0, so it always takes exactly
// 3 clicks (see subtreeState.ts).
function collapseFromDefault(container: HTMLElement, rootId: string) {
  const btn = container.querySelector(`#${rootId} .atlas-node-expand-all`)!;
  fireEvent.click(btn);
  fireEvent.click(btn);
  fireEvent.click(btn);
}

describe("AtlasReader real-component pendulum collapse", () => {
  it("collapsing a branch that starts open hides every descendant row (not just the count)", () => {
    const { atlas, flatNodes, a, kids } = makeWideTree(6);
    const data = makeLoadedData({ atlas, flatNodes, complete: true });
    // Navigate straight to `a`: the reveal-on-nav effect raises a's own rung
    // to 1 (it's the target), so all six children start rendered.
    const { container } = renderReader("a", null, data);
    for (const k of kids) expect(container.querySelector(`#${k.id}`)).not.toBeNull();

    collapseFromDefault(container, a.id);

    // the row advertises the hidden count …
    expect(container.querySelector(`#${a.id}`)?.textContent).toContain("6 hidden");
    // … and every descendant row is actually gone from the DOM
    for (const k of kids) expect(container.querySelector(`#${k.id}`)).toBeNull();
  });

  // Reproduces the reported bug: a row can be indented as if it were nested
  // under the collapsed node (its doc-number depth is deeper) while its
  // parentId was reparented above that node — exactly what the
  // heading-level-6 cap does to deeply-numbered docs. The reader indents by
  // realDepth (doc number) but must hide by the same VISUAL span, or the row
  // stays on screen even though it visually belongs to the branch that now
  // says "N hidden".
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
    // Navigate to root (not R): only root's own rung gets raised (R itself
    // is root's single visual child, so it becomes visible), but R stays
    // collapsed at its default rung 0 — no click needed to set this up,
    // which makes the assertion below stronger: it's exercising the
    // structural default, not a click sequence.
    const { container } = renderReader("root", null, data);

    // R is collapsed by default. The six real children are hidden …
    for (const k of kids) expect(container.querySelector(`#${k.id}`)).toBeNull();
    // … and so is the deeply-numbered ghost row, which visually nests within
    // R's span (it lands right after R's last real child, at a deeper
    // indent) even though its parentId points at the ROOT, not R …
    expect(container.querySelector("#ghost")).toBeNull();
    // … and the count reflects the whole visual span (6 children + the ghost = 7),
    // so "N hidden" matches exactly what's off-screen — hiding and counting
    // both key off the visual span, not parentId.
    expect(container.querySelector("#R")?.textContent).toContain("7 hidden");
  });
});
