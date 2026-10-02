// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ProvenanceBadge } from "./ProvenanceBadge";

afterEach(cleanup);

describe("ProvenanceBadge", () => {
  it("renders nothing for a live report, so the badge stays meaningful", () => {
    const { container } = render(<ProvenanceBadge provenance="live" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("labels an AI-assessed report and explains it in the tooltip", () => {
    render(<ProvenanceBadge provenance="ai-assessed" />);
    const badge = screen.getByText("AI-assessed");
    expect(badge).toHaveAttribute("title", expect.stringContaining("human-reviewed"));
    expect(badge).toHaveAttribute("data-state", "ai-assessed");
  });

  it("labels a curated report and warns it can lag the atlas", () => {
    render(<ProvenanceBadge provenance="curated" />);
    const badge = screen.getByText("curated");
    expect(badge).toHaveAttribute("title", expect.stringContaining("lag"));
    expect(badge).toHaveAttribute("data-state", "curated");
  });

  it("carries the meaning in text, not colour alone", () => {
    render(<ProvenanceBadge provenance="curated" />);
    expect(screen.getByText("curated").textContent?.trim()).toBeTruthy();
  });

  it("lets a caller override native span props (spread last)", () => {
    render(<ProvenanceBadge provenance="curated" className="custom" id="b1" />);
    const badge = screen.getByText("curated");
    expect(badge).toHaveClass("custom");
    expect(badge).toHaveAttribute("id", "b1");
  });
});
