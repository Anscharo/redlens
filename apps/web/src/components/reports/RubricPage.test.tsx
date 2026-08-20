// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { RubricPage } from "./RubricPage";

afterEach(cleanup);

describe("RubricPage", () => {
  it("renders the rubric's top-level heading from the markdown source", () => {
    render(<RubricPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Risk Rules Assessment Rubric" })).toBeInTheDocument();
  });

  it("renders at least one section heading (h2) from the rubric body", () => {
    render(<RubricPage />);
    expect(screen.getAllByRole("heading", { level: 2 }).length).toBeGreaterThan(0);
  });

  it("links back to the risk rules assessment report", () => {
    render(<RubricPage />);
    const link = screen.getByRole("link", { name: "risk rules assessment" });
    expect(link).toHaveAttribute("href", "/reports/risk-rules");
  });

  it("sets the document title while mounted", () => {
    const { unmount } = render(<RubricPage />);
    expect(document.title).toBe("Risk Assessment Rubric: Sky Atlas by Redline");
    unmount();
    expect(document.title).toBe("Sky Atlas by Redline");
  });
});
