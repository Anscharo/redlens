// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ParagraphChecks } from "./ParagraphChecks";
import type { ParagraphCheck } from "./chatTypes";

afterEach(cleanup);

describe("ParagraphChecks", () => {
  it("renders nothing when checks is undefined or empty", () => {
    const { container: a } = render(<ParagraphChecks checks={undefined} />);
    expect(a).toBeEmptyDOMElement();
    const { container: b } = render(<ParagraphChecks checks={[]} />);
    expect(b).toBeEmptyDOMElement();
  });

  it("marks a clean paragraph ok with a no-findings mark", () => {
    const checks: ParagraphCheck[] = [{ index: 0, text: "A clean paragraph.", findings: [] }];
    const { container } = render(<ParagraphChecks checks={checks} />);
    const li = container.querySelector("li");
    expect(li).toHaveAttribute("data-state", "ok");
    expect(screen.getByLabelText("no findings")).toBeInTheDocument();
  });

  it("marks a paragraph with findings as flagged and renders each finding", () => {
    const checks: ParagraphCheck[] = [
      { index: 2, text: "A disputed paragraph.", findings: ["unsupported figure", "wrong doc_no"] },
    ];
    const { container } = render(<ParagraphChecks checks={checks} />);
    const li = container.querySelector("li");
    expect(li).toHaveAttribute("data-state", "flagged");
    expect(screen.getByText("unsupported figure")).toBeInTheDocument();
    expect(screen.getByText("wrong doc_no")).toBeInTheDocument();
    expect(screen.queryByLabelText("no findings")).toBeNull();
  });

  it("shows a 1-based paragraph marker", () => {
    const checks: ParagraphCheck[] = [{ index: 3, text: "Fourth paragraph.", findings: [] }];
    render(<ParagraphChecks checks={checks} />);
    expect(screen.getByText("¶4")).toBeInTheDocument();
  });

  it("sets a title attribute so hovering identifies the paragraph", () => {
    const long = "x".repeat(120);
    const checks: ParagraphCheck[] = [{ index: 0, text: long, findings: [] }];
    const { container } = render(<ParagraphChecks checks={checks} />);
    const li = container.querySelector("li")!;
    expect(li.getAttribute("title")).toBe(`${long.slice(0, 80)}…`);
  });

  it("does not render the paragraph text itself", () => {
    const checks: ParagraphCheck[] = [{ index: 0, text: "Do not repeat me in the DOM body.", findings: [] }];
    render(<ParagraphChecks checks={checks} />);
    expect(screen.queryByText("Do not repeat me in the DOM body.")).toBeNull();
  });

  it("renders a pending model mark", () => {
    const checks: ParagraphCheck[] = [{ index: 0, text: "A paragraph.", findings: [], model: "pending" }];
    const { container } = render(<ParagraphChecks checks={checks} />);
    expect(container.querySelector("li")).toHaveAttribute("data-model", "pending");
    expect(screen.getByLabelText("model check pending")).toBeInTheDocument();
  });

  it("renders an ok model mark", () => {
    const checks: ParagraphCheck[] = [{ index: 0, text: "A paragraph.", findings: [], model: "ok" }];
    const { container } = render(<ParagraphChecks checks={checks} />);
    expect(container.querySelector("li")).toHaveAttribute("data-model", "ok");
    expect(screen.getByLabelText("no contradictions found")).toBeInTheDocument();
  });

  it("renders a candidate model mark", () => {
    const checks: ParagraphCheck[] = [{ index: 0, text: "A paragraph.", findings: [], model: "candidate" }];
    const { container } = render(<ParagraphChecks checks={checks} />);
    expect(container.querySelector("li")).toHaveAttribute("data-model", "candidate");
    expect(screen.getByLabelText("possible contradiction, being confirmed")).toBeInTheDocument();
  });

  it("renders a failed model mark", () => {
    const checks: ParagraphCheck[] = [{ index: 0, text: "A paragraph.", findings: [], model: "failed" }];
    const { container } = render(<ParagraphChecks checks={checks} />);
    expect(container.querySelector("li")).toHaveAttribute("data-model", "failed");
    expect(screen.getByLabelText("model check unavailable")).toBeInTheDocument();
  });

  it("renders no model mark when model is absent", () => {
    const checks: ParagraphCheck[] = [{ index: 0, text: "A paragraph.", findings: [] }];
    render(<ParagraphChecks checks={checks} />);
    expect(screen.queryByLabelText(/model check|contradiction/)).toBeNull();
  });
});
