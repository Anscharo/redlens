// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("./ConceptCensus", () => ({
  ConceptCensus: ({ slug }: { slug: string }) => <div data-testid="census-slot">census:{slug}</div>,
}));

import { LibraryMarkdown } from "./LibraryMarkdown";

afterEach(cleanup);

describe("LibraryMarkdown", () => {
  it("renders plain markdown as a single block when no census marker is present", () => {
    const { container } = render(<LibraryMarkdown raw={"# Title\n\nSome prose."} />);
    expect(screen.getByRole("heading", { name: "Title" })).toBeInTheDocument();
    expect(screen.getByText("Some prose.")).toBeInTheDocument();
    expect(container.querySelectorAll('[data-testid="census-slot"]')).toHaveLength(0);
  });

  it("splits a `:::census <slug>` marker line into a ConceptCensus slot between markdown segments", () => {
    const raw = ["# Before", "", ":::census transitionary-measures", "", "## After"].join("\n");
    render(<LibraryMarkdown raw={raw} />);
    expect(screen.getByRole("heading", { name: "Before" })).toBeInTheDocument();
    expect(screen.getByTestId("census-slot")).toHaveTextContent("census:transitionary-measures");
    expect(screen.getByRole("heading", { name: "After" })).toBeInTheDocument();
  });

  it("splits multiple markers into multiple independent census slots", () => {
    const raw = [":::census formula-docs", "middle text", ":::census prohibition-language"].join("\n");
    render(<LibraryMarkdown raw={raw} />);
    const slots = screen.getAllByTestId("census-slot");
    expect(slots).toHaveLength(2);
    expect(slots[0]).toHaveTextContent("census:formula-docs");
    expect(slots[1]).toHaveTextContent("census:prohibition-language");
    expect(screen.getByText("middle text")).toBeInTheDocument();
  });

  it("turns an inline code span holding a full UUID into a reader deep-link, but leaves a doc_no as plain code", () => {
    const raw = "See `55999acf-75fe-4adf-8584-9746ef50d3e4` and `A.3.2` for details.";
    render(<LibraryMarkdown raw={raw} />);
    const link = screen.getByRole("link", { name: "55999acf" });
    expect(link).toHaveAttribute("href", expect.stringContaining("55999acf-75fe-4adf-8584-9746ef50d3e4"));
    expect(screen.getByText("A.3.2").tagName).toBe("CODE");
  });
});
