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

/** Hover a segment and read the portalled pill's text (the pill lives in
 *  <body>, not in the segment — see MscTimeseriesPill). */
function pillTextFor(seg: HTMLElement): string | null | undefined {
  fireEvent.pointerEnter(seg);
  return document.body.querySelector(":scope > .msc-ts-pill")?.textContent;
}

function renderChart(onSelect = vi.fn()) {
  render(<MscTimeseries primes={PRIMES} months={MONTHS} primeLabel={label} selected="2026-07" onSelect={onSelect} />);
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
    expect(jul.map((el) => pillTextFor(el))).toEqual([
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
    expect(pillTextFor(keel)).toBe("Keel −$50k to Sky");
    const spark = document.querySelector('button[aria-label^="Aug 2026"] .msc-ts-seg[data-prime="spark"]') as HTMLElement;
    expect(parseFloat(keel.style.top)).toBeGreaterThan(parseFloat(spark.style.top));
  });

  it("writes 'Jan 2026' on one row up to six columns, and puts the year on its own row past that", () => {
    renderChart();
    const labelOf = (col: HTMLElement) => col.lastElementChild!.textContent;
    expect(labelOf(screen.getByRole("button", { name: /^Jun 2026/ }))).toBe("Jun 2026");
    cleanup();
    const run = Array.from({ length: 8 }, (_, i) => ({
      ...MONTHS[0],
      month: i < 2 ? `2025-${11 + i}` : `2026-0${i - 1}`,
    }));
    render(<MscTimeseries primes={PRIMES} months={run} primeLabel={label} selected="2026-01" onSelect={vi.fn()} />);
    const cols = screen.getAllByRole("button");
    expect(cols).toHaveLength(8);
    expect(labelOf(cols[0])).toBe("Nov2025");
    expect(labelOf(cols[1])).toBe("Dec ");
    expect(labelOf(cols[2])).toBe("Jan2026");
    expect(labelOf(cols[3])).toBe("Feb ");
  });

  it("has no play control of its own — that sits under the month on the headline card", () => {
    renderChart();
    expect(screen.queryByRole("button", { name: /autoplay|Play through/ })).not.toBeInTheDocument();
  });

  it("labels the y axis with round tick values and gridlines, at the denser half-step", () => {
    renderChart();
    const labels = [...document.querySelectorAll(".msc-ts-axis")].map((t) => t.textContent);
    // Was $0/$1.00M/$2.00M (posPeak/3); the /6 raw step halves it to $500k.
    expect(labels).toEqual(["$0", "$500k", "$1.00M", "$1.50M", "$2.00M"]);
    expect(document.querySelectorAll(".msc-ts-gridline").length).toBeGreaterThan(3);
  });

  it("floats each month's To-Sky total above its bar, to the nearest $100k, in the sky token", () => {
    renderChart();
    const totals = [...document.querySelectorAll(".msc-ts-total")] as HTMLElement[];
    // 1.0M / 2.0M / 950k → nearest $100k, rendered "1.0m"-style.
    expect(totals.map((t) => t.textContent)).toEqual(["1.0m", "2.0m", "1.0m"]);
    expect(totals.every((t) => t.style.color === "var(--msc-sky)")).toBe(true);
    // Never clipped off the top of the track, and the taller month sits higher.
    const tops = totals.map((t) => parseFloat(t.style.top));
    expect(Math.min(...tops)).toBeGreaterThanOrEqual(0);
    expect(tops[1]).toBeLessThan(tops[0]);
    // Decorative: the column button's aria-label already states the total.
    expect(totals.every((t) => t.closest("[aria-hidden='true']") !== null)).toBe(true);
  });

  it("renders the hover pill in the body, not inside the clipping chart wrapper", () => {
    renderChart();
    const seg = document.querySelector('.msc-ts-seg[data-prime="spark"]') as HTMLElement;
    fireEvent.pointerEnter(seg);
    const pill = document.body.querySelector(":scope > .msc-ts-pill") as HTMLElement;
    expect(pill).toBeTruthy();
    expect(pill.closest(".msc-ts-seg")).toBeNull();
    expect(pill).toHaveAttribute("data-align", "start");
    fireEvent.pointerLeave(seg);
    expect(document.body.querySelector(":scope > .msc-ts-pill")).toBeNull();
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
