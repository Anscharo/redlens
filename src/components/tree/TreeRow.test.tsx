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
    render(<TreeRow index={0} style={{}} {...data} />);

    const row = screen.getByRole("treeitem");
    expect(row).toHaveAttribute("aria-level", "2");
    expect(row).toHaveAttribute("aria-selected", "true");
    // Childless row has nothing to expand — no aria-expanded.
    expect(row).not.toHaveAttribute("aria-expanded");
  });

  it("sets aria-expanded on rows that have children, and renders a real <button> toggle", () => {
    const visibleNodes: VisibleNode[] = [{ node: node({ id: "n2" }), hasChildren: true, treeDepth: 1 }];
    const data = {
      ...baseData(visibleNodes),
      expandedIds: new Set(["n2"]),
    };
    render(<TreeRow index={0} style={{}} {...data} />);

    const row = screen.getByRole("treeitem");
    expect(row).toHaveAttribute("aria-expanded", "true");

    const toggle = screen.getByRole("button");
    expect(toggle.tagName).toBe("BUTTON");
  });

  it("reflects aria-selected=false and aria-expanded=false when not selected/expanded", () => {
    const visibleNodes: VisibleNode[] = [{ node: node({ id: "n3" }), hasChildren: true, treeDepth: 1 }];
    const data = baseData(visibleNodes);
    render(<TreeRow index={0} style={{}} {...data} />);

    const row = screen.getByRole("treeitem");
    expect(row).toHaveAttribute("aria-selected", "false");
    expect(row).toHaveAttribute("aria-expanded", "false");
  });
});
