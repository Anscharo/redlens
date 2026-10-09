// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

vi.mock("../../lib/analytics", () => ({ track: vi.fn(), captureException: vi.fn() }));
vi.mock("./TreeSidebar", () => ({
  TreeSidebar: ({ nodeId, onNavigate }: { nodeId: string | null; onNavigate: (id: string) => void }) => (
    <button type="button" data-testid="tree-sidebar" onClick={() => onNavigate("next")}>
      {nodeId ?? "none"}
    </button>
  ),
}));

import { TreeDrawer } from "./TreeDrawer";

function renderAt(path: string, onClose = vi.fn()) {
  const { hook, searchHook, history } = memoryLocation({ path, record: true });
  render(
    <Router hook={hook} searchHook={searchHook}>
      <TreeDrawer open onClose={onClose} />
    </Router>,
  );
  return { onClose, history };
}

// Drawer reads window.matchMedia on mount; jsdom lacks it.
beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TreeDrawer", () => {
  it.each(["/", "/atlas?id=a", "/search-hints"])("shows the tree on %s", (path) => {
    renderAt(path);
    expect(screen.getByTestId("tree-sidebar")).toBeInTheDocument();
  });

  it("is absent from routes without the tree", () => {
    renderAt("/radar");
    expect(screen.queryByTestId("tree-sidebar")).toBeNull();
  });

  it("highlights the reader's document", () => {
    renderAt("/atlas?id=a");
    expect(screen.getByTestId("tree-sidebar")).toHaveTextContent("a");
  });

  it("opens a picked document in the reader and closes the drawer", () => {
    const { onClose, history } = renderAt("/atlas?id=a");
    fireEvent.click(screen.getByTestId("tree-sidebar"));
    expect(history?.at(-1)).toBe("/atlas?id=next");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
