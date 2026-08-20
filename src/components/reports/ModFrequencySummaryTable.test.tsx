// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ModFrequencySummaryTable } from "./ModFrequencySummaryTable";
import type { ModFrequencySummaryRow } from "@/lib/modFrequencyIndex";

afterEach(cleanup);

const SUMMARY: ModFrequencySummaryRow[] = [
  { key: "A.2", label: "A.2 — Accessibility Scope", total: 4, matchCount: 2, matchPercent: 50 },
  { key: "NR", label: "NR", total: 1, matchCount: 1, matchPercent: 100 },
];

describe("ModFrequencySummaryTable", () => {
  it("renders one row per category with its label, match count, total, and percent", () => {
    render(<ModFrequencySummaryTable summary={SUMMARY} matchLabel="≤1 modification" />);
    expect(screen.getByText("A.2 — Accessibility Scope")).toBeInTheDocument();
    expect(screen.getByText("NR")).toBeInTheDocument();
    expect(screen.getByText("50.0%")).toBeInTheDocument();
    expect(screen.getByText("100.0%")).toBeInTheDocument();
  });

  it("renders the match label in the column headers", () => {
    render(<ModFrequencySummaryTable summary={SUMMARY} matchLabel="≤1 modification" />);
    const headers = Array.from(screen.getByRole("table").querySelectorAll("th")).map((th) => th.textContent);
    expect(headers).toEqual(["Category", "≤1 modification", "Total", "% ≤1 modification"]);
  });

  it("renders the match and total counts as separate cells", () => {
    render(<ModFrequencySummaryTable summary={SUMMARY} matchLabel="≤1 modification" />);
    const row = screen.getByText("A.2 — Accessibility Scope").closest("tr")!;
    const cells = Array.from(row.querySelectorAll("td")).map((td) => td.textContent);
    expect(cells).toEqual(["A.2 — Accessibility Scope", "2", "4", "50.0%"]);
  });

  it("renders no rows for an empty summary", () => {
    render(<ModFrequencySummaryTable summary={[]} matchLabel="≤1 modification" />);
    const table = screen.getByRole("table");
    expect(table.querySelector("tbody")?.children).toHaveLength(0);
  });
});
