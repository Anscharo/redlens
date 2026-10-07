// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MscSkyRevenue } from "./MscSkyRevenue";

afterEach(cleanup);

const MONTHS = [
  { month: "2026-07", income: 32_200_000, expenses: 21_680_000, net: 10_520_000, corrections: 960_000 },
  { month: "2026-08", income: 31_920_000, expenses: 16_170_000, net: 15_750_000, corrections: 0.4 },
];

describe("MscSkyRevenue", () => {
  it("draws Income, Expenses and Net Revenue per month, each linked to its Atlas definition", () => {
    render(<MscSkyRevenue months={MONTHS} />);
    expect(screen.getByRole("link", { name: "Income" })).toHaveAttribute("href", expect.stringContaining("a0fab275-399d-41ad-a9b0-411d3e5ea5c9"));
    expect(screen.getByRole("link", { name: "Expenses" })).toHaveAttribute("href", expect.stringContaining("88e3c367-fe30-4d59-8ba1-eddc0d88a0ea"));
    expect(screen.getByRole("link", { name: "Net Revenue" })).toHaveAttribute("href", expect.stringContaining("bddce7bf-c568-444b-b196-e15a99016696"));
    expect(document.querySelectorAll("svg.msc-skyrev rect.msc-skyrev-net")).toHaveLength(2);
    expect(screen.getByRole("img")).toHaveAccessibleName(expect.stringContaining("Net Revenue $15,750,000"));
    expect(screen.getByRole("button", { name: "Why these figures start in July 2026" })).toHaveTextContent("*");
  });

  it("notes prior-cycle corrections only for a month that carries them", () => {
    render(<MscSkyRevenue months={MONTHS} />);
    const notes = screen.getAllByRole("listitem");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toHaveTextContent("Jul 2026 Income includes $960k of prior-cycle corrections");
  });

  it("renders nothing without months", () => {
    const { container } = render(<MscSkyRevenue months={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
