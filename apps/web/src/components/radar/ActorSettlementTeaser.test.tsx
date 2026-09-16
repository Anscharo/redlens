// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { SettlementsBundle } from "../../lib/settlements";

const FIXTURE: SettlementsBundle = {
  source: { repo: "soterlabs/settlement-reports" },
  reports: [
    {
      prime: "spark",
      month: "2026-06",
      settleVersion: "0.4.0",
      generatedAt: null,
      period: null,
      headline: { primeAgentRevenue: 20, skyRevenue: 10, profitToGrove: 5, cof: 8, sdeRevenue: 2 },
      venues: [],
    },
    {
      prime: "spark",
      month: "2026-07",
      settleVersion: "0.4.0",
      generatedAt: null,
      period: null,
      headline: { primeAgentRevenue: 200, skyRevenue: 100, profitToGrove: 40, cof: 50, sdeRevenue: 50 },
      venues: [],
    },
    {
      prime: "keel",
      month: "2026-07",
      settleVersion: "0.4.0",
      generatedAt: null,
      period: null,
      headline: { primeAgentRevenue: 0, skyRevenue: 0, profitToGrove: 0, cof: 0, sdeRevenue: 0, agentRate: 32004, distributionRewards: 4227, primeAgentTotalRevenue: 36231 },
      venues: [],
    },
  ],
};

vi.mock("../../lib/settlements", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/settlements")>();
  return { ...actual, loadSettlements: () => Promise.resolve(FIXTURE) };
});

import { ActorSettlementTeaser } from "./ActorSettlementTeaser";

afterEach(() => {
  cleanup();
  window.history.pushState({}, "", "/radar/spark");
});

describe("ActorSettlementTeaser", () => {
  it("shows the trailing cycles as three separate totals, never summed, in ONE link to the full cycle page", async () => {
    render(<ActorSettlementTeaser slug="spark" name="Spark" />);
    // 2 cycles: sky 10 + 100 = 110; kept (20−8) + (200−50) = 162; no demand.
    await waitFor(() => expect(screen.getByText("$110")).toBeInTheDocument());
    // Scoped to the figures half: the legend names these series too.
    const figures = screen.getByTestId("msc-teaser").querySelector(".msc-teaser")!;
    expect(figures).toHaveTextContent(/\$110\s*to Sky/);
    expect(figures).toHaveTextContent("$162 supply-side kept");
    expect(figures).toHaveTextContent("$0 demand-side from Sky");
    expect(screen.getByText("Jun 2026 – Jul 2026 · 2 cycles")).toBeInTheDocument();
    // The removed design: no single summed figure, no "gross revenue" label.
    expect(screen.queryByText("$272")).not.toBeInTheDocument();
    expect(screen.queryByText(/gross revenue/)).not.toBeInTheDocument();
    const card = screen.getByTestId("msc-teaser");
    expect(card.tagName).toBe("A");
    expect(card).toHaveAttribute("href", "/radar/spark/settlements");
    expect(card).toContainElement(screen.getByText("$110"));
    expect(card).toContainElement(card.querySelector("svg"));
    expect(card).toHaveTextContent(/full cycle/);
    // The accessible name carries all three, each named, none added.
    expect(card).toHaveAccessibleName(
      "Spark over 2 cycles: $110 to Sky, $162 supply-side kept, $0 demand-side from Sky — open the settlement charts",
    );
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByText("OEA calculation, not the on-chain GovOps spell")).toBeInTheDocument();
  });

  it("charts the months as CLUSTERED three-way bars, the settlement page's summary shape", async () => {
    render(<ActorSettlementTeaser slug="spark" name="Spark" />);
    const chart = (await screen.findByTestId("msc-teaser")).querySelector(".msc-teaser-chart")!;
    const cols = [...chart.querySelectorAll(".msc-gross-col")];
    // Every month draws all three series, in the summary chart's order.
    expect(cols.map((c) => [...c.querySelectorAll("rect[data-series]")].map((r) => r.getAttribute("data-series")))).toEqual([
      ["sky", "kept", "demand"],
      ["sky", "kept", "demand"],
    ]);
    // Clustered, not stacked: within a month the bars sit side by side.
    const jul = [...cols[1].querySelectorAll("rect[data-series]")] as SVGRectElement[];
    const xs = jul.map((r) => parseFloat(r.getAttribute("x")!));
    expect(xs[1]).toBeGreaterThan(xs[0]);
    expect(xs[2]).toBeGreaterThan(xs[1]);
    // …and they share the zero line rather than resting on each other.
    const bottoms = jul.map((r) => parseFloat(r.getAttribute("y")!) + parseFloat(r.getAttribute("height")!));
    for (const b of bottoms) expect(b).toBeCloseTo(bottoms[0], 6);
    expect(cols[1].querySelectorAll(".msc-gross-pill")[1]).toHaveTextContent("$100 to Sky · $150 kept · $0 demand");
    // The legend names all three series.
    const legend = chart.querySelector(".msc-gross-legend")!;
    expect(legend).toHaveTextContent("to Sky");
    expect(legend).toHaveTextContent("supply-side kept");
    expect(legend).toHaveTextContent("demand-side");
    // The chart sits to the right of the figures.
    expect(chart.compareDocumentPosition(screen.getByText("$110")) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it("treats the composite-party slug as the prime", async () => {
    render(<ActorSettlementTeaser slug="spark-party" />);
    await waitFor(() => expect(screen.getByText("$110")).toBeInTheDocument());
    expect(screen.getByTestId("msc-teaser")).toHaveAttribute("href", "/radar/spark-party/settlements");
  });

  it("leads a demand-only Prime (Keel) with what Sky owes it, since it sent Sky nothing", async () => {
    render(<ActorSettlementTeaser slug="keel" name="Keel" />);
    await waitFor(() => expect(screen.getByText("$36k")).toBeInTheDocument());
    // The lead is the demand side, not a zero To-Sky figure.
    const card = screen.getByTestId("msc-teaser");
    expect(card.querySelector(".msc-teaser")).toHaveTextContent(/\$36k\s*demand-side from Sky/);
    // The period line; the chart's hover pill names the month too.
    expect(card.querySelector(".msc-teaser")).toHaveTextContent("Jul 2026");
    expect(card).toHaveAccessibleName(/Keel over 1 cycle: \$0 to Sky, \$0 supply-side kept, \$36k demand-side from Sky/);
    // All three bars still draw, so the shape matches every other Prime's.
    expect([...card.querySelectorAll("rect[data-series]")].map((r) => r.getAttribute("data-series"))).toEqual([
      "sky", "kept", "demand",
    ]);
    expect(card).toHaveAttribute("href", "/radar/keel/settlements");
  });

  it("leaves its own width to CSS, so the narrow breakpoint can still stack it", async () => {
    render(<ActorSettlementTeaser slug="spark" name="Spark" />);
    const card = await screen.findByTestId("msc-teaser");
    // No inline width and no width custom properties: the halves are sized
    // by `width: max-content` in index.css, which a media query can override.
    // An inline width could not be, which is the whole reason it lives there.
    expect(card.style.width).toBe("");
    expect(card.getAttribute("style")).not.toMatch(/width/);
    for (const half of [".msc-teaser", ".msc-teaser-chart"]) {
      expect((card.querySelector(half) as HTMLElement).style.width).toBe("");
    }
  });

  it("renders nothing for a slug with no MSC workbooks", async () => {
    const { rerender } = render(<ActorSettlementTeaser slug="spark" />);
    await screen.findByText("$110");
    rerender(<ActorSettlementTeaser slug="spark-proxy" />);
    expect(screen.queryByRole("heading", { name: "Monthly settlement" })).not.toBeInTheDocument();
  });
});
