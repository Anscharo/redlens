// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ModFrequencySummaryTable } from "./ModFrequencySummaryTable";
import type { ModFrequencySummaryRow } from "../../lib/modFrequencyIndex";

afterEach(cleanup);

const SUMMARY: ModFrequencySummaryRow[] = [
  { key: "A.2", label: "A.2 — Accessibility Scope", total: 4, zeroCount: 2, zeroPercent: 50 },
  { key: "NR", label: "NR", total: 1, zeroCount: 1, zeroPercent: 100 },
];

describe("ModFrequencySummaryTable", () => {
  it("renders one row per category with its label, zero count, total, and percent", () => {
    render(<ModFrequencySummaryTable summary={SUMMARY} />);
    expect(screen.getByText("A.2 — Accessibility Scope")).toBeInTheDocument();
    expect(screen.getByText("NR")).toBeInTheDocument();
    expect(screen.getByText("50.0%")).toBeInTheDocument();
    expect(screen.getByText("100.0%")).toBeInTheDocument();
  });

  it("renders the zero and total counts as separate cells", () => {
    render(<ModFrequencySummaryTable summary={SUMMARY} />);
    const row = screen.getByText("A.2 — Accessibility Scope").closest("tr")!;
    const cells = Array.from(row.querySelectorAll("td")).map((td) => td.textContent);
    expect(cells).toEqual(["A.2 — Accessibility Scope", "2", "4", "50.0%"]);
  });

  it("renders no rows for an empty summary", () => {
    render(<ModFrequencySummaryTable summary={[]} />);
    const table = screen.getByRole("table");
    expect(table.querySelector("tbody")?.children).toHaveLength(0);
  });
});
