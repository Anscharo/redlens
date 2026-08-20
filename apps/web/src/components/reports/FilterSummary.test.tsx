// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { FilterSummary } from "./FilterSummary";

afterEach(cleanup);

describe("FilterSummary", () => {
  it("renders nothing when there is no query and no active filters", () => {
    const { container } = render(<FilterSummary query="" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when filters are all falsy", () => {
    const { container } = render(<FilterSummary query="" filters={[false, null, undefined]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows just the query when only a query is active", () => {
    render(<FilterSummary query="vote" />);
    expect(screen.getByText(/showing all that/)).toBeInTheDocument();
    expect(screen.getByText('"vote"')).toBeInTheDocument();
    expect(screen.queryByText(/match filters/)).not.toBeInTheDocument();
  });

  it("shows just the filters when only filters are active", () => {
    render(<FilterSummary query="" filters={["Sky Base", "Endgame Edge"]} />);
    expect(screen.getByText("Sky Base + Endgame Edge")).toBeInTheDocument();
    expect(screen.queryByText(/contain/)).not.toBeInTheDocument();
  });

  it("joins query and filters with 'and' when both are active", () => {
    const { container } = render(<FilterSummary query="vote" filters={["Sky Base"]} />);
    expect(container.textContent).toContain('showing all that contain "vote" and match filters Sky Base');
  });

  it("filters out falsy filter entries from the joined label", () => {
    render(<FilterSummary query="" filters={["Sky Base", false, null, undefined, "Keel"]} />);
    expect(screen.getByText("Sky Base + Keel")).toBeInTheDocument();
  });

  it("appends the searches note only when a query and searches are both given", () => {
    const { rerender, container } = render(<FilterSummary query="vote" searches="title, agent" />);
    expect(container.textContent).toContain("searches: title, agent");

    rerender(<FilterSummary query="" filters={["Sky Base"]} searches="title, agent" />);
    expect(container.textContent).not.toContain("searches:");
  });

  it("unwraps a quoted query via displayQuery", () => {
    render(<FilterSummary query={'"vote weight"'} />);
    expect(screen.getByText('"vote weight"')).toBeInTheDocument();
  });
});
