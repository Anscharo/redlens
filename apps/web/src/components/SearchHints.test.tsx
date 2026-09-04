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
    expect(screen.getByText("subsidy")).toBeTruthy();
    expect(screen.getByText("singular/plural")).toBeTruthy();
    expect(screen.getByText("MCD_VAT")).toBeTruthy();
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
    expect(document.title).toBe("Search Hints: Sky Atlas by Redline");
    expect(screen.getByText("govern")).toBeTruthy();
  });
});
