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

  it("summarizes a clean run with a count and 'no findings', and renders no per-paragraph rows", () => {
    const checks: ParagraphCheck[] = [
      { index: 0, text: "A clean paragraph.", findings: [], model: "ok" },
      { index: 1, text: "Another clean one.", findings: [], model: "ok" },
    ];
    const { container } = render(<ParagraphChecks checks={checks} />);
    expect(screen.getByText("2 paragraphs checked, no findings")).toBeInTheDocument();
    expect(container.querySelector("li")).toBeNull();
    expect(container.querySelector("ul")).toBeNull();
  });

  it("uses singular phrasing for a single clean paragraph", () => {
    const checks: ParagraphCheck[] = [{ index: 0, text: "Only one.", findings: [], model: "ok" }];
    render(<ParagraphChecks checks={checks} />);
    expect(screen.getByText("1 paragraph checked, no findings")).toBeInTheDocument();
  });

  it("renders a row and counts it as flagged for a paragraph with a deterministic finding", () => {
    const checks: ParagraphCheck[] = [
      { index: 2, text: "A disputed paragraph.", findings: ["unsupported figure", "wrong doc_no"] },
    ];
    const { container } = render(<ParagraphChecks checks={checks} />);
    expect(screen.getByText("1 paragraph checked, 1 flagged")).toBeInTheDocument();
    const li = container.querySelector("li");
    expect(li).toHaveAttribute("data-state", "flagged");
    expect(screen.getByText("unsupported figure")).toBeInTheDocument();
    expect(screen.getByText("wrong doc_no")).toBeInTheDocument();
  });

  it("renders a row for a candidate model state even with no deterministic finding", () => {
    const checks: ParagraphCheck[] = [{ index: 0, text: "A paragraph.", findings: [], model: "candidate" }];
    const { container } = render(<ParagraphChecks checks={checks} />);
    expect(screen.getByText("1 paragraph checked, 1 flagged")).toBeInTheDocument();
    const li = container.querySelector("li")!;
    expect(li).toHaveAttribute("data-model", "candidate");
    expect(screen.getByLabelText("possible contradiction, being confirmed")).toBeInTheDocument();
  });

  it("renders a row for a failed model state even with no deterministic finding", () => {
    const checks: ParagraphCheck[] = [{ index: 0, text: "A paragraph.", findings: [], model: "failed" }];
    const { container } = render(<ParagraphChecks checks={checks} />);
    expect(screen.getByText("1 paragraph checked, 1 flagged")).toBeInTheDocument();
    const li = container.querySelector("li")!;
    expect(li).toHaveAttribute("data-model", "failed");
    expect(screen.getByLabelText("model check unavailable")).toBeInTheDocument();
  });

  it("renders no row for an ok or pending model state when there is no deterministic finding", () => {
    const checks: ParagraphCheck[] = [
      { index: 0, text: "A paragraph.", findings: [], model: "ok" },
      { index: 1, text: "Another.", findings: [], model: "pending" },
    ];
    const { container } = render(<ParagraphChecks checks={checks} />);
    expect(container.querySelector("li")).toBeNull();
  });

  it("says the model check is running once while any paragraph is still pending, instead of per row", () => {
    const checks: ParagraphCheck[] = [
      { index: 0, text: "A paragraph.", findings: [], model: "ok" },
      { index: 1, text: "Another.", findings: [], model: "pending" },
    ];
    render(<ParagraphChecks checks={checks} />);
    expect(screen.getByText("2 paragraphs checked, model check running")).toBeInTheDocument();
  });

  it("prefers the pending phrasing over a flagged count while a finding has already landed but another paragraph is still pending", () => {
    const checks: ParagraphCheck[] = [
      { index: 0, text: "Flagged already.", findings: ["wrong doc_no"] },
      { index: 1, text: "Still checking.", findings: [], model: "pending" },
    ];
    render(<ParagraphChecks checks={checks} />);
    expect(screen.getByText("2 paragraphs checked, model check running")).toBeInTheDocument();
  });

  it("shows a 1-based paragraph marker on a rendered row", () => {
    const checks: ParagraphCheck[] = [{ index: 3, text: "Fourth paragraph.", findings: ["a finding"] }];
    render(<ParagraphChecks checks={checks} />);
    expect(screen.getByText("¶4")).toBeInTheDocument();
  });

  it("sets a title attribute on a rendered row so hovering identifies the paragraph", () => {
    const long = "x".repeat(120);
    const checks: ParagraphCheck[] = [{ index: 0, text: long, findings: ["a finding"] }];
    const { container } = render(<ParagraphChecks checks={checks} />);
    const li = container.querySelector("li")!;
    expect(li.getAttribute("title")).toBe(`${long.slice(0, 80)}…`);
  });

  it("does not render the paragraph text itself", () => {
    const checks: ParagraphCheck[] = [{ index: 0, text: "Do not repeat me in the DOM body.", findings: ["a finding"] }];
    render(<ParagraphChecks checks={checks} />);
    expect(screen.queryByText("Do not repeat me in the DOM body.")).toBeNull();
  });

  it("renders a finding row with no model mark when model is absent", () => {
    const checks: ParagraphCheck[] = [{ index: 0, text: "A paragraph.", findings: ["a finding"] }];
    render(<ParagraphChecks checks={checks} />);
    expect(screen.queryByLabelText(/model check|contradiction/)).toBeNull();
  });
});
