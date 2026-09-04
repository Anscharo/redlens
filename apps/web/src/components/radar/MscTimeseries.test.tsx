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
    skyParts: [{ prime: "spark", value: 1_000_000 }],
  },
  {
    month: "2026-07",
    sky: 2_000_000,
    parts: [
      { prime: "spark", value: 500_000 },
      { prime: "keel", value: 280_000 },
      { prime: "osero", value: -50_000 },
    ],
    skyParts: [
      { prime: "spark", value: 1_500_000 },
      { prime: "osero", value: 500_000 },
    ],
  },
];
const PRIMES = ["spark", "keel", "osero"];
const label = (p: string) => p.charAt(0).toUpperCase() + p.slice(1);

afterEach(cleanup);

function renderChart(onSelect = vi.fn(), onTogglePlay = vi.fn(), playing = false) {
  render(
    <MscTimeseries
      primes={PRIMES}
      months={MONTHS}
      primeLabel={label}
      selected="2026-07"
      onSelect={onSelect}
      playing={playing}
      onTogglePlay={onTogglePlay}
    />,
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

  it("stacks To Sky per prime in a second track that sums to the line", () => {
    renderChart();
    const sky = document.querySelectorAll('.msc-ts-track-sky .msc-ts-seg[data-flow="sky"]');
    expect(sky).toHaveLength(3);
    const jul = [...sky].filter((el) => el.closest('button[aria-pressed="true"]')) as HTMLElement[];
    expect(jul.map((el) => el.getAttribute("title"))).toEqual(["Spark: $1.50M to Sky", "Osero: $500k to Sky"]);
    // Blue comes from CSS; the prime's color is the 2px outline.
    expect(jul[0].style.boxShadow).toContain("--msc-prime-1");
    expect(jul[0].style.background).toBe("");
    // Stack top (min top) meets the line's y for that month: heights sum to
    // the To-Sky total on the shared scale.
    const heights = jul.map((el) => parseFloat(el.style.height));
    const keptJul = [...document.querySelectorAll('button[aria-pressed="true"] .msc-ts-seg[data-flow="kept"]')] as HTMLElement[];
    const keptPos = keptJul.filter((el) => !el.style.background.includes("gradient")).map((el) => parseFloat(el.style.height));
    // 2.0M of sky vs 0.78M of positive kept on one scale.
    expect(heights.reduce((a, b) => a + b, 0) / keptPos.reduce((a, b) => a + b, 0)).toBeCloseTo(2_000_000 / 780_000, 1);
  });

  it("offers a play/pause control for the month autoplay", () => {
    const onToggle = vi.fn();
    renderChart(vi.fn(), onToggle, true);
    const btn = screen.getByRole("button", { name: "Pause the month autoplay" });
    expect(btn).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(btn);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("stacks per-prime segments with stable colors and titles, negatives as loss", () => {
    renderChart();
    const spark = document.querySelectorAll('[title="Spark: $500k"], [title="Spark: $400k"]');
    expect(spark).toHaveLength(2);
    for (const el of spark) {
      expect((el as HTMLElement).style.background).toContain("--msc-prime-1");
    }
    const osero = document.querySelector('[title="Osero: −$50k"]') as HTMLElement;
    // Negative months keep the prime's own color, marked by stripes.
    expect(osero.style.background).toContain("repeating-linear-gradient");
    expect(osero.style.background).toContain("--msc-prime-3");
    expect(osero.style.background).not.toContain("--accent");
  });

  it("draws the To-Sky line with hoverable points carrying their figure", () => {
    renderChart();
    const line = document.querySelector(".msc-ts-line polyline")!;
    expect(line.getAttribute("stroke")).toBe("var(--msc-sky)");
    const dots = document.querySelectorAll(".msc-ts-dot");
    expect(dots).toHaveLength(2);
    // Each point: an oversized hit circle, the visible dot, and its amount.
    expect(dots[0].querySelectorAll("circle")).toHaveLength(2);
    expect(dots[0].textContent).toBe("$1.00M");
    expect(dots[1].textContent).toBe("$2.00M");
  });

  it("labels the y axis with round tick values and gridlines", () => {
    renderChart();
    const labels = [...document.querySelectorAll(".msc-ts-axis")].map((t) => t.textContent);
    expect(labels).toEqual(["$0", "$1.00M", "$2.00M"]);
    expect(document.querySelectorAll(".msc-ts-gridline")).toHaveLength(3);
  });

  it("shows a legend entry per prime plus the line", () => {
    renderChart();
    expect(screen.getByText("Spark")).toBeInTheDocument();
    expect(screen.getByText("Keel")).toBeInTheDocument();
    expect(screen.getByText("Osero")).toBeInTheDocument();
    expect(screen.getByText("to Sky (line)")).toBeInTheDocument();
  });

  it("assigns fixed fills and folds overflow primes to gray", () => {
    expect(primeFill(0)).toBe("var(--msc-prime-1)");
    expect(primeFill(4)).toBe("var(--msc-prime-5)");
    expect(primeFill(5)).toBe("var(--gray)");
  });
});
