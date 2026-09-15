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
  it("shows total gross revenue across every cycle; the whole card is ONE link to the full cycle page", async () => {
    render(<ActorSettlementTeaser slug="spark" name="Spark" />);
    // Jun: par 20 − cof 8 = 12 kept + 10 to Sky = 22; Jul: 150 + 100 = 250.
    await waitFor(() => expect(screen.getByText("$272")).toBeInTheDocument());
    expect(screen.getByText("total gross revenue")).toBeInTheDocument();
    expect(screen.getByText("Jun 2026 – Jul 2026 · 2 cycles")).toBeInTheDocument();
    expect(screen.queryByText(/to Sky$/)).not.toBeInTheDocument();
    const figure = screen.getByText("$272");
    const card = screen.getByTestId("msc-teaser");
    expect(card.tagName).toBe("A");
    expect(card).toHaveAttribute("href", "/radar/spark/settlements");
    expect(card).toContainElement(figure);
    expect(card).toContainElement(card.querySelector("svg"));
    expect(card).toHaveTextContent(/full cycle/);
    expect(card).toHaveAccessibleName(/Spark: \$272 total gross revenue over 2 cycles/);
    // Figures and chart are two halves of the same link, not two links.
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByText("OEA calculation, not the on-chain GovOps spell")).toBeInTheDocument();
  });

  it("draws a stacked gross-revenue chart in the card's right half", async () => {
    render(<ActorSettlementTeaser slug="spark" name="Spark" />);
    const chart = (await screen.findByTestId("msc-teaser")).querySelector(".msc-teaser-chart")!;
    // One column per month, stacked to Sky then kept (no demand-side in the fixture).
    const cols = [...chart.querySelectorAll(".msc-gross-col")];
    expect(cols.map((c) => [...c.querySelectorAll("rect[data-series]")].map((r) => r.getAttribute("data-series")))).toEqual([
      ["sky", "kept"],
      ["sky", "kept"],
    ]);
    const jul = cols[1].querySelectorAll("rect[data-series]");
    expect(parseFloat(jul[1].getAttribute("y")!)).toBeLessThan(parseFloat(jul[0].getAttribute("y")!));
    expect(cols.map((c) => c.querySelector(".msc-gross-pill")?.textContent)).toEqual([
      "Jun 2026 · $22 gross",
      "Jul 2026 · $250 gross",
    ]);
    expect(cols[1].querySelectorAll(".msc-gross-pill")[1]).toHaveTextContent("to Sky $100 · kept $150 · demand $0");
    // The chart sits to the right of the figures.
    expect(chart.compareDocumentPosition(screen.getByText("$272")) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it("treats the composite-party slug as the prime", async () => {
    render(<ActorSettlementTeaser slug="spark-party" />);
    await waitFor(() => expect(screen.getByText("$272")).toBeInTheDocument());
    expect(screen.getByTestId("msc-teaser")).toHaveAttribute("href", "/radar/spark-party/settlements");
  });

  it("charts a demand-side-only Prime (Keel) too: its gross revenue is its rewards", async () => {
    render(<ActorSettlementTeaser slug="keel" name="Keel" />);
    await waitFor(() => expect(screen.getByText("$36k")).toBeInTheDocument());
    expect(screen.getByText("Jul 2026")).toBeInTheDocument();
    const card = screen.getByRole("link", { name: /Keel: \$36k total gross revenue over 1 cycle/ });
    expect([...card.querySelectorAll("rect[data-series]")].map((r) => r.getAttribute("data-series"))).toEqual(["demand"]);
    expect(card).toHaveAttribute("href", "/radar/keel/settlements");
  });

  it("renders nothing for a slug with no MSC workbooks", async () => {
    const { rerender } = render(<ActorSettlementTeaser slug="spark" />);
    await screen.findByText("$272");
    rerender(<ActorSettlementTeaser slug="spark-proxy" />);
    expect(screen.queryByRole("heading", { name: "Monthly settlement" })).not.toBeInTheDocument();
  });
});
