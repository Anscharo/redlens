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
  it("shows the cumulative amount to Sky over every cycle; the box is a link to the full cycle page", async () => {
    render(<ActorSettlementTeaser slug="spark" name="Spark" />);
    await waitFor(() => expect(screen.getByText("$110 to Sky")).toBeInTheDocument());
    expect(screen.getByText("Jun 2026 – Jul 2026 · 2 cycles")).toBeInTheDocument();
    expect(screen.queryByText("$100 to Sky")).not.toBeInTheDocument();
    const figure = screen.getByText("$110 to Sky");
    const box = screen.getByTestId("msc-teaser");
    expect(box.tagName).toBe("A");
    expect(box).toHaveAttribute("href", "/radar/spark/settlements");
    expect(box).toContainElement(figure);
    expect(box).toHaveTextContent(/full cycle/);
    expect(screen.getByText("OEA calculation, not the on-chain GovOps spell")).toBeInTheDocument();
  });

  it("draws a cumulative area chart beside the box that links to the same page", async () => {
    render(<ActorSettlementTeaser slug="spark" name="Spark" />);
    const chart = await screen.findByRole("link", { name: /Spark: \$110 to Sky over 2 cycles, cumulative/ });
    expect(chart).toHaveAttribute("href", "/radar/spark/settlements");
    expect(chart.querySelector(".msc-cum-area")).toBeTruthy();
    expect(chart.querySelector(".msc-cum-line")).toBeTruthy();
    // One hover column per month, each carrying that month's running total.
    const cols = [...chart.querySelectorAll(".msc-cum-col")];
    expect(cols.map((c) => c.querySelector(".msc-cum-pill")?.textContent)).toEqual([
      "Jun 2026 · $10 cumulative ($10 that month)",
      "Jul 2026 · $110 cumulative ($100 that month)",
    ]);
    expect(chart.compareDocumentPosition(screen.getByTestId("msc-teaser")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("treats the composite-party slug as the prime", async () => {
    render(<ActorSettlementTeaser slug="spark-party" />);
    await waitFor(() => expect(screen.getByText("$110 to Sky")).toBeInTheDocument());
    expect(screen.getByTestId("msc-teaser")).toHaveAttribute("href", "/radar/spark-party/settlements");
  });

  it("shows Keel's latest demand-side total as kept, with no chart, when nothing went to Sky", async () => {
    render(<ActorSettlementTeaser slug="keel" name="Keel" />);
    await waitFor(() => expect(screen.getByText("$36,231 kept")).toBeInTheDocument());
    expect(screen.getByText("Jul 2026")).toBeInTheDocument();
    expect(screen.queryByText("$0 to Sky")).not.toBeInTheDocument();
    expect(document.querySelector(".msc-teaser-chart")).toBeNull();
    expect(screen.getByTestId("msc-teaser")).toHaveAttribute("href", "/radar/keel/settlements");
  });

  it("renders nothing for a slug with no MSC workbooks", async () => {
    const { rerender } = render(<ActorSettlementTeaser slug="spark" />);
    await screen.findByText("$110 to Sky");
    rerender(<ActorSettlementTeaser slug="spark-proxy" />);
    expect(screen.queryByRole("heading", { name: "Monthly settlement" })).not.toBeInTheDocument();
  });
});
