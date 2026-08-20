// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { NoRowsMatch } from "./NoRowsMatch";

afterEach(cleanup);

describe("NoRowsMatch", () => {
  it("shows the quoted query when one is given", () => {
    render(<NoRowsMatch query="vote" />);
    expect(screen.getByText('No rows match "vote".')).toBeInTheDocument();
  });

  it("falls back to 'the current filters' when the query is blank", () => {
    render(<NoRowsMatch query="" />);
    expect(screen.getByText("No rows match the current filters.")).toBeInTheDocument();
  });

  it("falls back when the query is only whitespace", () => {
    render(<NoRowsMatch query="   " />);
    expect(screen.getByText("No rows match the current filters.")).toBeInTheDocument();
  });

  it("unwraps a quoted query via displayQuery", () => {
    render(<NoRowsMatch query={"'Strict Term'"} />);
    expect(screen.getByText('No rows match "Strict Term".')).toBeInTheDocument();
  });
});
