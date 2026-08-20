// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { ChunkNode } from "../../lib/crossview";
import { atlasHref } from "@/lib/routes";
import { CrossViewTreemap } from "./CrossViewTreemap";

function wrap() {
  const { hook } = memoryLocation({ path: "/reports/crossview", record: true });
  return ({ children }: { children: React.ReactNode }) => <Router hook={hook}>{children}</Router>;
}

afterEach(cleanup);

const TREE: ChunkNode[] = [
  {
    id: "root-a",
    title: "Root A",
    docs: 90,
    children: [
      { id: "child-a1", doc_no: "A.1.1", title: "Child A1", docs: 60 },
      { id: "child-a2", doc_no: "A.1.2", title: "Child A2", docs: 30 },
    ],
  },
  { title: "Root B", docs: 10 }, // no id — should render with no reader link
];

describe("CrossViewTreemap", () => {
  it("shows the default hint in the info panel before any hover", () => {
    render(<CrossViewTreemap tree={TREE} atlasTotal={100} />, { wrapper: wrap() });
    expect(screen.getByText(/Hover a square for details/)).toBeInTheDocument();
  });

  it("renders labels for large-enough rects", () => {
    render(<CrossViewTreemap tree={TREE} atlasTotal={100} />, { wrapper: wrap() });
    expect(screen.getByText("Root A")).toBeInTheDocument();
    expect(screen.getByText("Root B")).toBeInTheDocument();
  });

  it("fills the info panel with breadcrumb, title, doc count, and reader link on hover of a leaf with an id", () => {
    render(<CrossViewTreemap tree={TREE} atlasTotal={100} />, { wrapper: wrap() });
    const child = screen.getByText("Child A1").closest("div") as HTMLElement;
    fireEvent.mouseOver(child);

    const panel = within(screen.getByRole("complementary"));
    expect(panel.getByText("Root A")).toBeInTheDocument(); // breadcrumb = ancestors only, excluding self
    expect(panel.getByText(/A\.1\.1/)).toBeInTheDocument();
    expect(panel.getByText(/60% of the Atlas/)).toBeInTheDocument();
    const link = panel.getByRole("link", { name: /open in reader/ });
    expect(link).toHaveAttribute("href", atlasHref("child-a1"));
  });

  it("shows sub-chunk count for a hovered rect with children, and no reader link when the rect has no id", () => {
    render(<CrossViewTreemap tree={TREE} atlasTotal={100} />, { wrapper: wrap() });
    const panel = within(screen.getByRole("complementary"));
    const rootA = screen.getByText("Root A").closest("div") as HTMLElement;
    fireEvent.mouseOver(rootA);
    expect(panel.getByText(/2 sub-chunks/)).toBeInTheDocument();

    const rootB = screen.getByText("Root B").closest("div") as HTMLElement;
    fireEvent.mouseOver(rootB);
    expect(panel.queryByRole("link", { name: /open in reader/ })).not.toBeInTheDocument();
    // Root B is a top-level rect — empty ancestor path falls back to "Atlas".
    expect(panel.getByText("Atlas")).toBeInTheDocument();
  });

  it("clears the hovered rect and reverts to the default hint on mouse leave", () => {
    render(<CrossViewTreemap tree={TREE} atlasTotal={100} />, { wrapper: wrap() });
    const rootA = screen.getByText("Root A").closest("div") as HTMLElement;
    fireEvent.mouseOver(rootA);
    expect(screen.queryByText(/Hover a square for details/)).not.toBeInTheDocument();

    const outer = screen.getByRole("img", { name: /Treemap of Atlas chunks/ });
    fireEvent.mouseLeave(outer);
    expect(screen.getByText(/Hover a square for details/)).toBeInTheDocument();
  });
});
