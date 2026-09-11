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
  {
    month: "2026-08",
    sky: 950_000,
    parts: [{ prime: "spark", value: 100_000 }],
    skyParts: [
      { prime: "spark", value: 1_000_000 },
      { prime: "keel", value: -50_000 },
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
  it("renders a clickable column per month with the To-Sky total in the aria-label", () => {
    const onSelect = renderChart();
    const jul = screen.getByRole("button", { name: "Jul 2026: $2.00M to Sky across 2 primes" });
    expect(jul).toHaveAttribute("aria-pressed", "true");
    const jun = screen.getByRole("button", { name: "Jun 2026: $1.00M to Sky across 1 prime" });
    fireEvent.click(jun);
    expect(onSelect).toHaveBeenCalledWith("2026-06");
  });

  it("stacks what each Prime sent to Sky as solid segments in the Prime's color, one track per month", () => {
    renderChart();
    expect(document.querySelectorAll('button[aria-pressed="true"] .msc-ts-track')).toHaveLength(1);
    const jul = [...document.querySelectorAll('button[aria-pressed="true"] .msc-ts-seg[data-flow="sky"]')] as HTMLElement[];
    expect(jul.map((el) => el.querySelector(".msc-ts-pill")?.textContent)).toEqual([
      "Spark $1.50M to Sky",
      "Osero $500k to Sky",
    ]);
    expect(jul[0].style.background).toBe("var(--msc-prime-1)");
    expect(jul[1].style.background).toBe("var(--msc-prime-3)");
    expect(jul[0].style.outline).toBe("");
    // The stack sums to the month's total on the shared scale: 2.0M vs 1.0M.
    const heights = jul.map((el) => parseFloat(el.style.height));
    const jun = document.querySelector('.msc-ts-seg[data-prime="spark"]') as HTMLElement;
    expect(heights.reduce((a, b) => a + b, 0) / parseFloat(jun.style.height)).toBeCloseTo(2, 1);
    // No kept track, no total line, no micro labels: the stack top is the total.
    expect(document.querySelector('.msc-ts-track[data-flow="kept"]')).toBeNull();
    expect(document.querySelector(".msc-ts-line")).toBeNull();
    expect(document.querySelector(".msc-ts-microlabel")).toBeNull();
  });

  it("marks a negative month with loss-red stripes below the zero line", () => {
    renderChart();
    const keel = document.querySelector('.msc-ts-seg[data-prime="keel"]') as HTMLElement;
    expect(keel.style.background).toContain("repeating-linear-gradient");
    expect(keel.style.background).toContain("--msc-loss");
    expect(keel.querySelector(".msc-ts-pill")?.textContent).toBe("Keel −$50k to Sky");
    const spark = document.querySelector('button[aria-label^="Aug 2026"] .msc-ts-seg[data-prime="spark"]') as HTMLElement;
    expect(parseFloat(keel.style.top)).toBeGreaterThan(parseFloat(spark.style.top));
  });

  it("offers a play/pause control for the month autoplay", () => {
    const onToggle = vi.fn();
    renderChart(vi.fn(), onToggle, true);
    const btn = screen.getByRole("button", { name: "Pause the month autoplay" });
    expect(btn).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(btn);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("labels the y axis with round tick values and gridlines", () => {
    renderChart();
    const labels = [...document.querySelectorAll(".msc-ts-axis")].map((t) => t.textContent);
    expect(labels).toEqual(["$0", "$1.00M", "$2.00M"]);
    expect(document.querySelectorAll(".msc-ts-gridline")).toHaveLength(3);
  });

  it("shows a legend entry per prime, above the chart", () => {
    renderChart();
    expect(screen.getByText("Spark")).toBeInTheDocument();
    expect(screen.getByText("Keel")).toBeInTheDocument();
    expect(screen.getByText("Osero")).toBeInTheDocument();
    expect(screen.queryByText("to Sky (line)")).not.toBeInTheDocument();
    const legend = screen.getByText("Spark").closest("p")!;
    const chart = document.querySelector(".msc-ts-grid")!;
    expect(legend.compareDocumentPosition(chart) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("assigns fills by roster order and folds the overflow to gray", () => {
    expect(primeFill(0)).toBe("var(--msc-prime-1)");
    expect(primeFill(5)).toBe("var(--msc-prime-6)");
    expect(primeFill(6)).toBe("var(--gray)");
  });
});
