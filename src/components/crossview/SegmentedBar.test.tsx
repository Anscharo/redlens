// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { cloneElement, type ReactElement } from "react";
import { render, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { CrossViewSegment } from "@/lib/crossview";

// Tooltip only renders `content` on hover (timer-gated) — irrelevant to this
// component's layout math. Stub it to stamp the content onto the child
// element so segment identity/title is assertable without fake timers.
vi.mock("../Tooltip", () => ({
  Tooltip: ({ content, children }: { content: unknown; children: ReactElement<Record<string, unknown>> }) =>
    cloneElement(children, { "data-tooltip": typeof content === "string" ? content : undefined }),
}));

import { SegmentedBar } from "./SegmentedBar";

afterEach(cleanup);

// Structure: <div.h-3> (track) > <div flex> (fill, width=barPct%) > segment divs.
function segDivs(container: HTMLElement): HTMLElement[] {
  const track = container.firstElementChild as HTMLElement;
  const fill = track.firstElementChild as HTMLElement;
  return Array.from(fill.children) as HTMLElement[];
}

describe("SegmentedBar", () => {
  it("filters out zero-docs segments", () => {
    const segments: CrossViewSegment[] = [
      { id: "a", doc_no: "", title: "A", docs: 10 },
      { id: "z", doc_no: "", title: "Zero", docs: 0 },
    ];
    const { container } = render(<SegmentedBar value={10} max={10} segments={segments} />);
    const divs = segDivs(container);
    expect(divs).toHaveLength(1);
    expect(divs[0].dataset.tooltip).toContain("A —");
  });

  it("renders a single full-width fallback fill when there are no segments", () => {
    const { container } = render(<SegmentedBar value={10} max={10} segments={[]} />);
    const track = container.firstElementChild as HTMLElement;
    const fill = track.firstElementChild as HTMLElement;
    // No per-segment Tooltip wrappers — just the one bare red div.
    expect(fill.children).toHaveLength(1);
    expect(fill.firstElementChild).not.toHaveAttribute("data-tooltip");
    expect((fill.firstElementChild as HTMLElement).style.background).toBe("var(--red)");
  });

  it("scales the track fill width to value/max, with a 1% floor", () => {
    const segments: CrossViewSegment[] = [{ id: "a", doc_no: "", title: "A", docs: 5 }];
    const { container } = render(<SegmentedBar value={5} max={100} segments={segments} />);
    const track = container.firstElementChild as HTMLElement;
    const fill = track.firstElementChild as HTMLElement;
    expect(fill.style.width).toBe("5%");

    const { container: c2 } = render(<SegmentedBar value={0} max={100} segments={segments} />);
    const fill2 = (c2.firstElementChild as HTMLElement).firstElementChild as HTMLElement;
    expect(fill2.style.width).toBe("1%"); // Math.max(1, ...) floor
  });

  it("does not merge a single thin tail segment — only multi-segment tails collapse", () => {
    // segSum=1000, barPct=100 → pxOf(docs) = docs/1000*440. "tiny" (5 docs)
    // is below the 4px threshold alone in the tail (tail.length === 1), so it
    // renders individually instead of collapsing into a merged block.
    const segments: CrossViewSegment[] = [
      { id: "big", doc_no: "", title: "Big", docs: 995 },
      { id: "tiny", doc_no: "", title: "Tiny", docs: 5 },
    ];
    const { container } = render(<SegmentedBar value={1000} max={1000} segments={segments} />);
    const divs = segDivs(container);
    expect(divs).toHaveLength(2);
    expect(divs[1].dataset.tooltip).toContain("Tiny —");
    expect(divs[1].dataset.tooltip).not.toContain("smaller sections");
  });

  it("merges multiple thin tail segments into one '+N smaller sections' block with reduced opacity", () => {
    // segSum=1000, barPct=100 → pxOf(docs) = docs/1000*440. Threshold is 4px,
    // i.e. docs < ~9.09 stay invisible individually. Two big + three tiny.
    const segments: CrossViewSegment[] = [
      { id: "a", doc_no: "", title: "A", docs: 490 },
      { id: "b", doc_no: "", title: "B", docs: 490 },
      { id: "c", doc_no: "", title: "C", docs: 7 },
      { id: "d", doc_no: "", title: "D", docs: 7 },
      { id: "e", doc_no: "", title: "E", docs: 6 },
    ];
    const { container } = render(<SegmentedBar value={1000} max={1000} segments={segments} />);
    const divs = segDivs(container);
    // 2 visible + 1 merged tail block.
    expect(divs).toHaveLength(3);
    const tail = divs[2];
    expect(tail.dataset.tooltip).toContain("3 smaller sections");
    expect(tail.dataset.tooltip).toContain("20 docs"); // 7 + 7 + 6
    expect(tail.style.opacity).toBe("0.3");
  });

  it("computes a descending opacity gradient across non-tail segments, full strength on the first", () => {
    const segments: CrossViewSegment[] = [
      { id: "a", doc_no: "", title: "A", docs: 50 },
      { id: "b", doc_no: "", title: "B", docs: 30 },
      { id: "c", doc_no: "", title: "C", docs: 20 },
    ];
    const { container } = render(<SegmentedBar value={100} max={100} segments={segments} />);
    const divs = segDivs(container);
    expect(divs).toHaveLength(3);
    // opacity = 1 - (i / (n-1)) * 0.65
    expect(divs[0].style.opacity).toBe("1");
    expect(divs[1].style.opacity).toBe(String(1 - (1 / 2) * 0.65));
    expect(divs[2].style.opacity).toBe(String(1 - (2 / 2) * 0.65));
  });

  it("gives a lone segment full opacity (no gradient divide-by-zero)", () => {
    const segments: CrossViewSegment[] = [{ id: "a", doc_no: "", title: "Only", docs: 10 }];
    const { container } = render(<SegmentedBar value={10} max={10} segments={segments} />);
    const divs = segDivs(container);
    expect(divs).toHaveLength(1);
    expect(divs[0].style.opacity).toBe("1");
    expect(divs[0].style.width).toBe("100%");
  });
});
