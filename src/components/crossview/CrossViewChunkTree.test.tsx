// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { cloneElement, type ReactElement } from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { ChunkNode } from "@/lib/crossview";
import { atlasHref } from "@/lib/routes";

// Tooltip only renders its `content` on hover (timer-gated) — irrelevant to
// what this component computes. Stub it to stamp the content onto the child
// element instead, so segment/title tooltip text is assertable without fake
// timers, mirroring the SegmentedBar tests' approach to the same component.
vi.mock("../Tooltip", () => ({
  Tooltip: ({ content, children }: { content: unknown; children: ReactElement<Record<string, unknown>> }) =>
    cloneElement(children, { "data-tooltip": typeof content === "string" ? content : undefined }),
}));

import { CrossViewChunkTree } from "./CrossViewChunkTree";

function wrap() {
  const { hook } = memoryLocation({ path: "/reports/crossview", record: true });
  return ({ children }: { children: React.ReactNode }) => <Router hook={hook}>{children}</Router>;
}

afterEach(cleanup);

describe("CrossViewChunkTree", () => {
  it("renders a leaf row with no expand affordance and a disabled toggle", () => {
    const tree: ChunkNode[] = [{ title: "Leaf only", doc_no: "A.9", docs: 5 }];
    render(<CrossViewChunkTree tree={tree} atlasTotal={100} />, { wrapper: wrap() });
    const toggle = screen.getByRole("button", { name: "Leaf only" });
    expect(toggle).toBeDisabled();
    expect(toggle).not.toHaveAttribute("aria-expanded");
  });

  it("expands to show children on click, toggling aria-expanded", () => {
    const tree: ChunkNode[] = [
      {
        title: "Parent",
        docs: 10,
        children: [
          { id: "k1", doc_no: "A.1.1", title: "Kid 1", docs: 6 },
          { id: "k2", doc_no: "A.1.2", title: "Kid 2", docs: 4 },
        ],
      },
    ];
    render(<CrossViewChunkTree tree={tree} atlasTotal={100} />, { wrapper: wrap() });
    const toggle = screen.getByRole("button", { name: "Parent" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/Kid 1/)).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/Kid 1/)).toBeInTheDocument();
    expect(screen.getByText(/Kid 2/)).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/Kid 1/)).not.toBeInTheDocument();
  });

  it("scales a child row's bar against the largest SIBLING, not the parent's own max", () => {
    const tree: ChunkNode[] = [
      {
        title: "Parent",
        docs: 10,
        children: [
          { id: "k1", doc_no: "A.1.1", title: "Kid 1", docs: 8 },
          { id: "k2", doc_no: "A.1.2", title: "Kid 2", docs: 2 },
        ],
      },
    ];
    render(<CrossViewChunkTree tree={tree} atlasTotal={100} />, { wrapper: wrap() });
    fireEvent.click(screen.getByRole("button", { name: "Parent" }));
    // Kid 1's bar is scaled against max(8, 2) = 8, so it fills 100% width.
    const kid1Row = screen.getByText(/Kid 1/).closest("div[style*='grid-template-columns']") as HTMLElement;
    const bar1 = kid1Row.querySelector(".h-3") as HTMLElement;
    expect((bar1.firstChild as HTMLElement).style.width).toBe("100%");
    const kid2Row = screen.getByText(/Kid 2/).closest("div[style*='grid-template-columns']") as HTMLElement;
    const bar2 = kid2Row.querySelector(".h-3") as HTMLElement;
    expect((bar2.firstChild as HTMLElement).style.width).toBe("25%"); // 2/8 * 100
  });

  it("includes a 'smaller sections' remainder segment only when remainder >= 5", () => {
    const bigRemainder: ChunkNode[] = [
      {
        title: "Parent",
        docs: 20,
        children: [{ id: "k1", doc_no: "A.1.1", title: "Kid 1", docs: 10 }],
      },
    ]; // remainder = 10
    const { container, unmount } = render(<CrossViewChunkTree tree={bigRemainder} atlasTotal={100} />, { wrapper: wrap() });
    fireEvent.click(screen.getByRole("button", { name: "Parent" }));
    expect(container.querySelector('[data-tooltip*="smaller sections"]')).toBeInTheDocument();
    unmount();

    const smallRemainder: ChunkNode[] = [
      {
        title: "Parent",
        docs: 13,
        children: [{ id: "k1", doc_no: "A.1.1", title: "Kid 1", docs: 10 }],
      },
    ]; // remainder = 3, below the >=5 threshold
    const { container: container2 } = render(<CrossViewChunkTree tree={smallRemainder} atlasTotal={100} />, { wrapper: wrap() });
    fireEvent.click(screen.getByRole("button", { name: "Parent" }));
    expect(container2.querySelector('[data-tooltip*="smaller sections"]')).not.toBeInTheDocument();
  });

  it("shows a link-out icon only when the chunk maps to a single atlas node, and it stops propagation", () => {
    const tree: ChunkNode[] = [
      {
        title: "Parent",
        docs: 10,
        id: "parent-node",
        children: [{ id: "k1", doc_no: "A.1.1", title: "Kid 1", docs: 8 }],
      },
    ];
    render(<CrossViewChunkTree tree={tree} atlasTotal={100} />, { wrapper: wrap() });
    const link = screen.getByRole("link", { name: "Open Parent in the reader" });
    expect(link).toHaveAttribute("href", atlasHref("parent-node"));

    // Clicking the link-out icon must not toggle the row open (stopPropagation).
    const toggle = screen.getByRole("button", { name: "Parent" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(link);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Kid 1")).not.toBeInTheDocument();
  });

  it("omits the link-out icon when the chunk has no single-node id", () => {
    const tree: ChunkNode[] = [{ title: "Group only", docs: 5, children: [{ doc_no: "A.1", title: "Kid", docs: 5 }] }];
    render(<CrossViewChunkTree tree={tree} atlasTotal={100} />, { wrapper: wrap() });
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows the doc_no at depth 0 only when rootDocNo is set, and always at deeper depths", () => {
    const tree: ChunkNode[] = [
      { title: "Root", doc_no: "A.1", docs: 10, children: [{ doc_no: "A.1.1", title: "Child", docs: 6 }] },
    ];
    const { unmount } = render(<CrossViewChunkTree tree={tree} atlasTotal={100} />, { wrapper: wrap() });
    expect(screen.queryByText(/A\.1 Root/)).not.toBeInTheDocument();
    expect(screen.getByText("Root")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Root" }));
    expect(screen.getByText(/A\.1\.1 Child/)).toBeInTheDocument();
    unmount();

    render(<CrossViewChunkTree tree={tree} atlasTotal={100} rootDocNo />, { wrapper: wrap() });
    expect(screen.getByText(/A\.1 Root/)).toBeInTheDocument();
  });

  it("formats the percentage as an integer at >=10% and one decimal below 10%", () => {
    const tree: ChunkNode[] = [
      { title: "Big", docs: 50, doc_no: "A.1" },
      { title: "Small", docs: 5, doc_no: "A.2" },
    ];
    render(<CrossViewChunkTree tree={tree} atlasTotal={100} />, { wrapper: wrap() });
    expect(screen.getByText("·50%")).toBeInTheDocument();
    expect(screen.getByText("·5.0%")).toBeInTheDocument();
  });
});
