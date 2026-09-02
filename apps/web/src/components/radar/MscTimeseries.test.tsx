// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MscTimeseries, primeFill } from "./MscTimeseries";
import type { PrimeStackMonth } from "@/lib/settlementsOverview";

const MONTHS: PrimeStackMonth[] = [
  {
    month: "2026-06",
    sky: 1_000_000,
    parts: [{ prime: "spark", value: 400_000 }],
  },
  {
    month: "2026-07",
    sky: 2_000_000,
    parts: [
      { prime: "spark", value: 500_000 },
      { prime: "keel", value: 280_000 },
      { prime: "osero", value: -50_000 },
    ],
  },
];
const PRIMES = ["spark", "keel", "osero"];
const label = (p: string) => p.charAt(0).toUpperCase() + p.slice(1);

afterEach(cleanup);

function renderChart(onSelect = vi.fn()) {
  render(
    <MscTimeseries primes={PRIMES} months={MONTHS} primeLabel={label} selected="2026-07" onSelect={onSelect} />,
  );
  return onSelect;
}

describe("MscTimeseries", () => {
  it("renders a clickable column per month with the figures in the aria-label", () => {
    const onSelect = renderChart();
    const jul = screen.getByRole("button", {
      name: "Jul 2026: $730k prime-side earnings across 3 primes, $2.00M to Sky",
    });
    expect(jul).toHaveAttribute("aria-pressed", "true");
    const jun = screen.getByRole("button", { name: /Jun 2026: \$400k prime-side/ });
    fireEvent.click(jun);
    expect(onSelect).toHaveBeenCalledWith("2026-06");
  });

  it("stacks per-prime segments with stable colors and titles, negatives as loss", () => {
    renderChart();
    const spark = document.querySelectorAll('[title="Spark: $500k"], [title="Spark: $400k"]');
    expect(spark).toHaveLength(2);
    for (const el of spark) {
      expect((el as HTMLElement).style.background).toContain("--depth-1");
    }
    const osero = document.querySelector('[title="Osero: −$50k"]') as HTMLElement;
    // Negative months keep the prime's own color, marked by stripes.
    expect(osero.style.background).toContain("repeating-linear-gradient");
    expect(osero.style.background).toContain("--depth-5");
    expect(osero.style.background).not.toContain("--accent");
  });

  it("draws the To-Sky line and dots in the sky series color", () => {
    renderChart();
    const line = document.querySelector(".msc-ts-line polyline")!;
    expect(line.getAttribute("stroke")).toBe("var(--msc-sky)");
    expect(document.querySelectorAll(".msc-ts-line circle")).toHaveLength(2);
  });

  it("shows a legend entry per prime plus the line", () => {
    renderChart();
    expect(screen.getByText("Spark")).toBeInTheDocument();
    expect(screen.getByText("Keel")).toBeInTheDocument();
    expect(screen.getByText("Osero")).toBeInTheDocument();
    expect(screen.getByText("to Sky (line)")).toBeInTheDocument();
  });

  it("assigns fixed fills and folds overflow primes to gray", () => {
    expect(primeFill(0)).toBe("var(--depth-1)");
    expect(primeFill(4)).toBe("var(--depth-2)");
    expect(primeFill(5)).toBe("var(--gray)");
  });
});
