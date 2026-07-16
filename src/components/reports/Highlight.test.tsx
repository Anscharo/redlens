// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from "vitest";
import { render } from "@testing-library/react";
import { Highlight, MatchAside } from "./Highlight";
import { parseReportQuery, type HiddenMatch } from "../../lib/reportFilter";

// MatchAside wires a ResizeObserver in a layout effect; jsdom lacks it. The
// anchor (offsetParent) is null in jsdom so the observer is never constructed,
// but stub it defensively so the effect can't throw on any jsdom version.
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const marks = (el: HTMLElement) => [...el.querySelectorAll("mark.q-mark")].map((m) => m.textContent);

describe("Highlight", () => {
  it("wraps the matched substring in <mark class=q-mark>", () => {
    const { container } = render(<Highlight text="Weekly rate update" rq={parseReportQuery("rate")} />);
    expect(marks(container)).toEqual(["rate"]);
    expect(container.textContent).toBe("Weekly rate update");
  });

  it("marks every needle occurrence and keeps surrounding text", () => {
    const { container } = render(<Highlight text="rate up, rate down" rq={parseReportQuery("rate")} />);
    expect(marks(container)).toEqual(["rate", "rate"]);
  });

  it("prefers the longest overlapping needle", () => {
    const { container } = render(<Highlight text="the rate" rq={parseReportQuery("rat rate")} />);
    expect(marks(container)).toEqual(["rate"]);
  });

  it("strict queries mark case-sensitively", () => {
    const { container } = render(<Highlight text="rate and Rate" rq={parseReportQuery("'Rate'")} />);
    expect(marks(container)).toEqual(["Rate"]);
  });

  it("flex bridges internal whitespace for entity-name cells", () => {
    const { container } = render(<Highlight text="Sky Base" rq={parseReportQuery("skybase")} flex />);
    expect(marks(container)).toEqual(["Sky Base"]);
  });

  it("renders plain text (no marks) when nothing matches", () => {
    const { container } = render(<Highlight text="nothing here" rq={parseReportQuery("rate")} />);
    expect(marks(container)).toEqual([]);
    expect(container.textContent).toBe("nothing here");
  });

  it("renders the raw text for an empty query", () => {
    const { container } = render(<Highlight text="the rate" rq={parseReportQuery("")} />);
    expect(marks(container)).toEqual([]);
    expect(container.textContent).toBe("the rate");
  });

  it("handles null/undefined text without throwing", () => {
    const { container } = render(<Highlight text={null} rq={parseReportQuery("rate")} />);
    expect(container.textContent).toBe("");
  });
});

describe("MatchAside", () => {
  it("renders one labelled, highlighted excerpt per hidden match", () => {
    const matches: HiddenMatch[] = [
      { label: "agent", excerpt: "Sky Base", despace: true },
      { label: "quote", excerpt: "…within the Executive Vote…" },
    ];
    const { container } = render(<MatchAside matches={matches} rq={parseReportQuery("skybase vote")} />);
    const labels = [...container.querySelectorAll(".match-aside-label")].map((n) => n.textContent);
    expect(labels).toEqual(["agent", "quote"]);
    // The despace field bridges the space; the prose field marks the literal word.
    expect([...container.querySelectorAll("mark.q-mark")].map((m) => m.textContent)).toContain("Sky Base");
    expect([...container.querySelectorAll("mark.q-mark")].map((m) => m.textContent)).toContain("Vote");
  });

  it("renders nothing when there are no matches", () => {
    const { container } = render(<MatchAside matches={[]} rq={parseReportQuery("rate")} />);
    expect(container.querySelector(".match-aside")).toBeNull();
  });
});
