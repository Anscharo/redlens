// @vitest-environment jsdom
// TimelineRow is the rail every history block rides — entries (with a node dot)
// and the connective blocks between them (disclaimers, the toggle, footers). The
// look depends on absolutely-positioned segments that jsdom can't lay out, so
// these pin the *structure*: which segments exist, where they're anchored, and
// that consecutive rows can't leave a gap. Real geometry lives in e2e.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { TimelineRow, CONTENT_INDENT, LINE1_H } from "./Timeline";

afterEach(cleanup);

/** The rail is the row's aria-hidden gutter; its spans are the drawn segments. */
function rail(container: HTMLElement) {
  const el = container.querySelector("[aria-hidden='true']") as HTMLElement | null;
  return { el, spans: [...(el?.querySelectorAll("span") ?? [])] as HTMLElement[] };
}

describe("TimelineRow with a node dot", () => {
  it("draws a dot, its tick, and a segment above and below it", () => {
    const { container } = render(<TimelineRow dot="var(--accent)">entry</TimelineRow>);
    const { spans } = rail(container);
    const dot = spans.find((s) => s.className.includes("rounded-full"));
    expect(dot).toBeTruthy();
    // above + below + tick + dot
    expect(spans).toHaveLength(4);
    // The tick reaches across the gutter gap to where the entry text starts.
    const tick = spans.find((s) => s.style.height === "1px");
    expect(tick).toBeTruthy();
  });

  it("trims only the upward segment for the topmost row", () => {
    const { container } = render(
      <TimelineRow dot="var(--accent)" hideTop>
        entry
      </TimelineRow>,
    );
    const { spans } = rail(container);
    expect(spans).toHaveLength(3); // no segment above the dot
    expect(spans.find((s) => s.className.includes("rounded-full"))).toBeTruthy();
  });

  it("anchors the dot and its downward line at the same offset, and bleeds past the row", () => {
    const { container } = render(<TimelineRow dot="var(--accent)">entry</TimelineRow>);
    const { spans } = rail(container);
    const dot = spans.find((s) => s.className.includes("rounded-full"))!;
    const down = spans.find((s) => s.style.bottom !== "")!;
    expect(down.style.top).toBe(dot.style.top);
    // A negative bottom carries the line across the row boundary — that 1px bleed
    // is what makes a run of rows read as one unbroken timeline.
    expect(parseFloat(down.style.bottom)).toBeLessThan(0);
  });

  it("pads the content of a dotted row so the dot centers on its first line", () => {
    const { container } = render(<TimelineRow dot="var(--accent)">entry</TimelineRow>);
    const content = rail(container).el!.nextElementSibling!;
    expect(content).toHaveClass("py-2.5");
    // The dot offset derives from LINE1_H, so the two must stay in the same module.
    expect(LINE1_H).toBeGreaterThan(0);
  });
});

describe("TimelineRow without a dot", () => {
  it("draws one full-height line for a connective block", () => {
    const { container } = render(<TimelineRow>disclaimer</TimelineRow>);
    const { spans } = rail(container);
    expect(spans).toHaveLength(1);
    expect(spans[0].style.top).toBe("0px");
  });

  it("draws nothing when it is the topmost block", () => {
    const { container } = render(<TimelineRow hideTop>disclaimer</TimelineRow>);
    expect(rail(container).spans).toHaveLength(0);
  });

  it("brings no padding of its own — connective blocks carry their own margins", () => {
    const { container } = render(<TimelineRow>disclaimer</TimelineRow>);
    expect(rail(container).el!.nextElementSibling).not.toHaveClass("py-2.5");
  });

  it("hides the rail from assistive tech and keeps the content readable", () => {
    render(<TimelineRow dot="var(--accent)">the entry</TimelineRow>);
    expect(screen.getByText("the entry")).toBeInTheDocument();
  });
});

describe("CONTENT_INDENT", () => {
  it("matches where a row's content column starts, so standalone text can line up", () => {
    const { container } = render(<TimelineRow dot="var(--accent)">entry</TimelineRow>);
    const { el } = rail(container);
    // gutter width + the row's gap
    const gap = parseFloat((el!.parentElement as HTMLElement).style.gap);
    expect(parseFloat(el!.style.width) + gap).toBe(CONTENT_INDENT);
  });
});
