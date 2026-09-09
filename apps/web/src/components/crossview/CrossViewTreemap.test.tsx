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
      { id: "child-tiny", doc_no: "A.1.3", title: "Nested Tiny", docs: 1 }, // 1% of Atlas — omitted
    ],
  },
  { title: "Root B", docs: 8 },
  { title: "Root Tiny", docs: 2 }, // 2% of Atlas, but top-level — keep
];

function rectFor(title: string): HTMLElement {
  return screen.getByText(title).closest("div") as HTMLElement;
}

describe("CrossViewTreemap", () => {
  it("shows the default hint in the info panel before any click", () => {
    render(<CrossViewTreemap tree={TREE} atlasTotal={100} />, { wrapper: wrap() });
    expect(screen.getByText(/Click a square for details/)).toBeInTheDocument();
  });

  it("omits nested chunks under 2% of the Atlas", () => {
    render(<CrossViewTreemap tree={TREE} atlasTotal={100} />, { wrapper: wrap() });
    expect(screen.getByText("Root A")).toBeInTheDocument();
    expect(screen.getByText("Root B")).toBeInTheDocument();
    expect(screen.queryByText("Nested Tiny")).not.toBeInTheDocument();
  });

  it("renders Sky Primitives subsections that hold ≥ 2% of the Atlas", () => {
    const deep: ChunkNode[] = [
      {
        title: "Agent artifacts",
        docs: 70,
        children: [
          {
            title: "List of Prime Agent Artifacts",
            docs: 70,
            children: [
              {
                title: "Spark",
                docs: 21,
                children: [
                  {
                    title: "Sky Primitives",
                    docs: 18,
                    children: [{ title: "Supply Side", docs: 15 }],
                  },
                ],
              },
            ],
          },
        ],
      },
      { title: "Accessibility", docs: 1 },
    ];
    render(<CrossViewTreemap tree={deep} atlasTotal={100} />, { wrapper: wrap() });
    expect(screen.getByText("Spark")).toBeInTheDocument();
    expect(screen.getByText("Sky Primitives")).toBeInTheDocument();
    expect(screen.getByText("Supply Side")).toBeInTheDocument();
  });

  it("caps the map at 540px", () => {
    render(<CrossViewTreemap tree={TREE} atlasTotal={100} />, { wrapper: wrap() });
    expect(screen.getByRole("img", { name: /Treemap of Atlas chunks/ })).toHaveStyle({ maxWidth: "540px" });
  });

  it("sits the details beside the map from 650px of available width, stacked below that", () => {
    render(<CrossViewTreemap tree={TREE} atlasTotal={100} />, { wrapper: wrap() });
    const map = screen.getByRole("img", { name: /Treemap of Atlas chunks/ });
    const row = map.parentElement as HTMLElement;
    expect(row.className).toMatch(/@min-\[650px\]:flex-row/);
    expect(row).toContainElement(screen.getByRole("complementary"));
  });

  it("fills the info panel with breadcrumb, title, doc count, and reader link on click of a leaf with an id", () => {
    render(<CrossViewTreemap tree={TREE} atlasTotal={100} />, { wrapper: wrap() });
    fireEvent.click(rectFor("Child A1"));

    const panel = within(screen.getByRole("complementary"));
    expect(panel.getByText("Root A")).toBeInTheDocument(); // breadcrumb = ancestors only, excluding self
    expect(panel.getByText(/A\.1\.1/)).toBeInTheDocument();
    expect(panel.getByText(/60% of the Atlas/)).toBeInTheDocument();
    const link = panel.getByRole("link", { name: /open in reader/ });
    expect(link).toHaveAttribute("href", atlasHref("child-a1"));
  });

  it("keeps the selected details (and reader link) after the pointer leaves the map", () => {
    render(<CrossViewTreemap tree={TREE} atlasTotal={100} />, { wrapper: wrap() });
    fireEvent.click(rectFor("Child A1"));
    const outer = screen.getByRole("img", { name: /Treemap of Atlas chunks/ });
    fireEvent.mouseLeave(outer);
    const panel = within(screen.getByRole("complementary"));
    expect(panel.getByRole("link", { name: /open in reader/ })).toHaveAttribute("href", atlasHref("child-a1"));
  });

  it("toggles the selected rect off on a second click", () => {
    render(<CrossViewTreemap tree={TREE} atlasTotal={100} />, { wrapper: wrap() });
    const rootA = rectFor("Root A");
    fireEvent.click(rootA);
    expect(rootA).toHaveAttribute("data-state", "active");
    expect(screen.queryByText(/Click a square for details/)).not.toBeInTheDocument();

    fireEvent.click(rootA);
    expect(rootA).toHaveAttribute("data-state", "inactive");
    expect(screen.getByText(/Click a square for details/)).toBeInTheDocument();
  });

  it("shows sub-chunk count for a selected rect with children, and no reader link when the rect has no id", () => {
    render(<CrossViewTreemap tree={TREE} atlasTotal={100} />, { wrapper: wrap() });
    const panel = within(screen.getByRole("complementary"));
    fireEvent.click(rectFor("Root A"));
    expect(panel.getByText(/3 sub-chunks/)).toBeInTheDocument();

    fireEvent.click(rectFor("Root B"));
    expect(panel.queryByRole("link", { name: /open in reader/ })).not.toBeInTheDocument();
    // Root B is a top-level rect — empty ancestor path falls back to "Atlas".
    expect(panel.getByText("Atlas")).toBeInTheDocument();
  });
});
