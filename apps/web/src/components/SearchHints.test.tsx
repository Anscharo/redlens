// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SearchHints, SearchHintsPage } from "./SearchHints";

afterEach(cleanup);

describe("SearchHints (cheat sheet table)", () => {
  it("renders the syntax hints table with example queries and descriptions", () => {
    render(<SearchHints onSearch={vi.fn()} />);
    expect(screen.getByText("govern")).toBeTruthy();
    expect(
      screen.getByText("Default mode — partial words match automatically, case-insensitive"),
    ).toBeTruthy();
    expect(
      screen.getByText("Double quotes — literal substring match, case-insensitive"),
    ).toBeTruthy();
    expect(screen.getByText("MCD_VAT")).toBeTruthy();
  });

  it("groups the hints under category headings", () => {
    render(<SearchHints onSearch={vi.fn()} />);
    // rowheader, not columnheader: the group headings label the rows beneath
    // them (scope="rowgroup"), which is the whole point of the grouping.
    const headings = screen
      .getAllByRole("rowheader")
      .map((th) => th.textContent ?? "")
      .filter((t) => t.includes("Narrow") || t.includes("Combine") || t.includes("modes") || t.includes("identifier"));
    expect(headings).toHaveLength(4);
    // "Narrow a search" leads: in:/exclude are the least discoverable syntax.
    expect(headings[0]).toContain("Narrow a search");
  });

  it("drops the retired fuzzy and singular/plural rows", () => {
    render(<SearchHints onSearch={vi.fn()} />);
    expect(screen.queryByText("misaligment~1")).toBeNull();
    expect(screen.queryByText("singular/plural")).toBeNull();
    expect(screen.queryByText("subsidy")).toBeNull();
  });

  it("calls onSearch with the example query when a row is clicked", () => {
    const onSearch = vi.fn();
    render(<SearchHints onSearch={onSearch} />);
    fireEvent.click(screen.getByText("govern").closest("tr")!);
    expect(onSearch).toHaveBeenCalledWith("govern");
  });
});

describe("SearchHints (slash filter mode)", () => {
  it("shows matching slash commands and lets one be clicked", () => {
    const onSearch = vi.fn();
    render(<SearchHints onSearch={onSearch} slashFilter="/r" />);
    expect(screen.getByText("/reports")).toBeTruthy();
    expect(screen.getByText("/radar")).toBeTruthy();
    expect(screen.queryByText("/h")).toBeNull();
    fireEvent.click(screen.getByText("/reports"));
    expect(onSearch).toHaveBeenCalledWith("/reports");
  });

  it("shows a no-match message when the slash filter matches nothing", () => {
    render(<SearchHints onSearch={vi.fn()} slashFilter="/zzz" />);
    expect(screen.getByText("no matching slash commands")).toBeTruthy();
  });

  it("shows all slash commands for an empty (but defined) slashFilter", () => {
    render(<SearchHints onSearch={vi.fn()} slashFilter="/" />);
    expect(screen.getByText("/reports")).toBeTruthy();
    expect(screen.getByText("/radar")).toBeTruthy();
    expect(screen.getByText("/h")).toBeTruthy();
  });

  it("falls back to the full hints table when slashFilter is null/undefined", () => {
    render(<SearchHints onSearch={vi.fn()} slashFilter={null} />);
    expect(screen.getByText("govern")).toBeTruthy();
  });
});

describe("SearchHintsPage", () => {
  it("sets the document title and renders the hints table", () => {
    render(<SearchHintsPage onHintClick={vi.fn()} />);
    expect(document.title).toBe("Search Hints: Redline Portal");
    expect(screen.getByText("govern")).toBeTruthy();
  });
});
