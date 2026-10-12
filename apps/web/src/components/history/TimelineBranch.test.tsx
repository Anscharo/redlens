// @vitest-environment jsdom
// A preview branch's commits: TimelineDashedSection draws one dashed line, faded
// at both ends, and each TimelineBranch hangs a spur and dot off it with the
// commit's lines indented past the dot. jsdom cannot lay out, so these pin
// structure.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { TimelineBranch, TimelineDashedSection } from "./TimelineBranch";

afterEach(cleanup);

describe("TimelineDashedSection", () => {
  // The fade is a mask jsdom does not parse (it holds a calc()); the e2e and
  // browser checks see it.
  it("draws one dashed line spanning all its rows", () => {
    const { container } = render(<TimelineDashedSection><p>rows</p></TimelineDashedSection>);
    const line = container.querySelector<HTMLElement>("[data-timeline-section]")!;
    expect(line.style.backgroundImage).toContain("repeating-linear-gradient");
    expect(line.style.top).toBe("0px");
    expect(line.style.bottom).toBe("0px");
  });
});

describe("TimelineBranch", () => {
  it("draws no rail line of its own, and hangs the spur and dot off the section's line", () => {
    const { container } = render(<TimelineBranch dot="var(--accent)">commit</TimelineBranch>);
    const rail = container.querySelector("[data-timeline-rail]")!;
    expect(rail.querySelectorAll("span")).toHaveLength(0);
    const spur = container.querySelector<HTMLElement>("[data-timeline-spur]")!;
    const dot = container.querySelector<HTMLElement>("[data-timeline-dot]")!;
    // The spur starts on the rail (left of the content edge) and ends at the dot.
    expect(parseFloat(spur.style.left)).toBeLessThan(0);
    expect(parseFloat(spur.style.left) + parseFloat(spur.style.width)).toBe(parseFloat(dot.style.left));
    expect(dot.style.background).toBe("var(--accent)");
  });

  it("indents the commit's lines past the dot", () => {
    render(<TimelineBranch dot="var(--accent)"><p>commit body</p></TimelineBranch>);
    const body = screen.getByText("commit body").parentElement!;
    expect(parseFloat(body.style.paddingLeft)).toBeGreaterThan(parseFloat(document.querySelector<HTMLElement>("[data-timeline-dot]")!.style.left));
  });

  it("without a dot is an indented row on the rail, with no spur", () => {
    const { container } = render(<TimelineBranch>merge marker</TimelineBranch>);
    expect(container.querySelector("[data-timeline-spur]")).toBeNull();
    expect(container.querySelector("[data-timeline-dot]")).toBeNull();
    expect(parseFloat(screen.getByText("merge marker").style.paddingLeft)).toBeGreaterThan(0);
  });
});
