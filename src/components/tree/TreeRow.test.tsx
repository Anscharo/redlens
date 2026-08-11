// @vitest-environment jsdom
// Regression test: TreeSidebar sets role="tree" on the container but rows were
// plain divs with no treeitem semantics, and the expand toggle was a <span>
// with a click handler instead of a native <button>. Assistive tech had no way
// to tell rows apart from generic content or know which are expandable/selected.

import { describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";

// truncateTitle measures text via @chenglou/pretext, which needs a real canvas
// (unavailable in jsdom) — stub it so TreeRow can render without the width math.
vi.mock("../../lib/treeUtils", () => ({
  truncateTitle: (title: string) => title,
}));

import { TreeRow, type VisibleNode, type TreeRowData } from "./TreeRow";
import type { AtlasNode } from "../../types";

afterEach(cleanup);

// react-window supplies these to every RowComponent; TreeRow doesn't consume
// them, so a stub is enough to satisfy RowComponentProps.
const aria = { "aria-posinset": 1, "aria-setsize": 1, role: "listitem" } as const;

function node(over: Partial<AtlasNode> = {}): AtlasNode {
  return {
    id: "n1",
    doc_no: "A.1",
    title: "A Title",
    type: "Core",
    depth: 1,
    parentId: null,
    content: "",
    order: 1,
    addressRefs: [],
    ...over,
  };
}

function baseData(visibleNodes: VisibleNode[]): TreeRowData {
  return {
    visibleNodes,
    selectedIndex: -1,
    focusedIndex: -1,
    expandedIds: new Set(),
    rollup: new Map(),
    flashing: new Set(),
    isPreview: false,
    sidebarWidth: 242,
    cradle: null,
    onNavigate: () => {},
    onToggle: () => {},
    onReveal: () => {},
  };
}

describe("TreeRow ARIA semantics", () => {
  it("sets role=treeitem, aria-level, and aria-selected on the row", () => {
    const visibleNodes: VisibleNode[] = [{ node: node(), hasChildren: false, treeDepth: 2 }];
    const data = { ...baseData(visibleNodes), selectedIndex: 0 };
    render(<TreeRow index={0} style={{}} ariaAttributes={aria} {...data} />);

    const row = screen.getByRole("treeitem");
    expect(row).toHaveAttribute("aria-level", "2");
    expect(row).toHaveAttribute("aria-selected", "true");
    // Childless row has nothing to expand — no aria-expanded.
    expect(row).not.toHaveAttribute("aria-expanded");
  });

  // The hover hint is CSS (`content: "Open " attr(data-hint)` in index.css), so
  // the attribute is the only testable seam. It must hold the FULL title — the
  // visible span is truncated to fit the sidebar, which is the whole reason the
  // hint exists.
  it("carries the full untruncated title in data-hint, with no competing native title=", () => {
    const long = "A Very Long Document Title That The Sidebar Would Otherwise Clip";
    const visibleNodes: VisibleNode[] = [
      { node: node({ title: long }), hasChildren: false, treeDepth: 1 },
    ];
    render(<TreeRow index={0} style={{}} ariaAttributes={aria} {...baseData(visibleNodes)} />);

    const row = screen.getByRole("treeitem");
    expect(row).toHaveAttribute("data-hint", long);
    // A native tooltip here would be a second, slower, differently-worded copy
    // of the same hint — the two-tooltips bug this replaced.
    expect(row.querySelector("[title]")).toBeNull();
  });

  it("sets aria-expanded on rows that have children, and renders a real <button> toggle", () => {
    const visibleNodes: VisibleNode[] = [{ node: node({ id: "n2" }), hasChildren: true, treeDepth: 1 }];
    const data = {
      ...baseData(visibleNodes),
      expandedIds: new Set(["n2"]),
    };
    render(<TreeRow index={0} style={{}} ariaAttributes={aria} {...data} />);

    const row = screen.getByRole("treeitem");
    expect(row).toHaveAttribute("aria-expanded", "true");

    const toggle = screen.getByRole("button");
    expect(toggle.tagName).toBe("BUTTON");
  });

  it("reflects aria-selected=false and aria-expanded=false when not selected/expanded", () => {
    const visibleNodes: VisibleNode[] = [{ node: node({ id: "n3" }), hasChildren: true, treeDepth: 1 }];
    const data = baseData(visibleNodes);
    render(<TreeRow index={0} style={{}} ariaAttributes={aria} {...data} />);

    const row = screen.getByRole("treeitem");
    expect(row).toHaveAttribute("aria-selected", "false");
    expect(row).toHaveAttribute("aria-expanded", "false");
  });
});

// The footer hint (useContextHints) reads these markers off the DOM, so the
// attribute is the only seam. It answers "what can I do here" WITHOUT the
// modifier held — the ::after labels in index.css only appear once you already
// know to press Shift.
describe("TreeRow footer-hint markers", () => {
  // On the title alone. Shift-click works anywhere on the row, but marking the
  // row itself fired the hint while crossing the chiclets and the chevron too,
  // so it was up almost constantly.
  it("marks the title — not the whole row — as the shift-click surface", () => {
    const visibleNodes: VisibleNode[] = [{ node: node(), hasChildren: true, treeDepth: 1 }];
    render(<TreeRow index={0} style={{}} ariaAttributes={aria} {...baseData(visibleNodes)} />);
    const row = screen.getByRole("treeitem");
    expect(row).not.toHaveAttribute("data-mod-hint");
    expect(row.querySelector('[data-mod-hint="split"]')?.textContent).toBe("A Title");
  });

  it("marks the chevron by direction, so the hint names the move it will make", () => {
    const visibleNodes: VisibleNode[] = [{ node: node({ id: "n6" }), hasChildren: true, treeDepth: 1 }];
    const collapsed = baseData(visibleNodes);
    const { rerender } = render(<TreeRow index={0} style={{}} ariaAttributes={aria} {...collapsed} />);
    expect(screen.getByRole("button")).toHaveAttribute("data-mod-hint", "cascade");

    rerender(
      <TreeRow index={0} style={{}} ariaAttributes={aria} {...collapsed} expandedIds={new Set(["n6"])} />,
    );
    expect(screen.getByRole("button")).toHaveAttribute("data-mod-hint", "cascade-collapse");
  });
});

describe("TreeRow chevron placement", () => {
  it("renders the toggle button after the doc-number chiclets, not before", () => {
    const visibleNodes: VisibleNode[] = [{ node: node({ id: "n4" }), hasChildren: true, treeDepth: 1 }];
    const data = baseData(visibleNodes);
    const { container } = render(<TreeRow index={0} style={{}} ariaAttributes={aria} {...data} />);

    const row = container.querySelector('[role="treeitem"]')!;
    const children = Array.from(row.children);
    const chicletsIndex = children.findIndex((el) => el.classList.contains("atlas-chiclets"));
    const toggleIndex = children.findIndex((el) => el.tagName === "BUTTON" && el.classList.contains("tree-toggle"));
    expect(chicletsIndex).toBeGreaterThanOrEqual(0);
    expect(toggleIndex).toBeGreaterThan(chicletsIndex);
  });

  // The sidebar chevron shows state by SWAPPING GLYPH, not by rotating — the
  // rotate-toward-the-next-state hover preview is the reader's chevron alone.
  it("swaps the glyph between collapsed (▸) and expanded (▾)", () => {
    const visibleNodes: VisibleNode[] = [{ node: node({ id: "n5" }), hasChildren: true, treeDepth: 1 }];
    const collapsed = baseData(visibleNodes);
    const { rerender } = render(<TreeRow index={0} style={{}} ariaAttributes={aria} {...collapsed} />);
    expect(screen.getByRole("button").textContent).toBe("▸");

    const expanded = { ...collapsed, expandedIds: new Set(["n5"]) };
    rerender(<TreeRow index={0} style={{}} ariaAttributes={aria} {...expanded} />);
    expect(screen.getByRole("button").textContent).toBe("▾");
  });
});
