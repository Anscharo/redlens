// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
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
      venues: [
        {
          id: "S1", label: "June venue", chain: "ethereum", synthetic: false,
          revenueToPrime: 20, cofAlloc: 8, profitToSky: 10, profitToGrove: 5,
        },
      ],
    },
    {
      prime: "spark",
      month: "2026-07",
      settleVersion: "0.4.0",
      generatedAt: null,
      period: null,
      headline: { primeAgentRevenue: 200, skyRevenue: 100, profitToGrove: 40, cof: 50, sdeRevenue: 50 },
      venues: [
        {
          id: "S1", label: "SparkLend USDS", chain: "ethereum", synthetic: false,
          revenueToPrime: 90, cofAlloc: 50, profitToSky: 60, profitToGrove: 30,
        },
        {
          id: "SPREAD", label: "Spread", chain: "", synthetic: true,
          revenueToPrime: 10, cofAlloc: 0, profitToSky: 40, profitToGrove: 10,
        },
      ],
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

import { ActorSettlements } from "./ActorSettlements";

afterEach(() => {
  cleanup();
  window.history.pushState({}, "", "/radar/spark");
});

describe("ActorSettlements", () => {
  it("renders Spark figures, the Sankey, and the venue table for the latest month", async () => {
    render(<ActorSettlements slug="spark" name="Spark" />);
    await waitFor(() => expect(screen.getByText("Kept by Spark")).toBeInTheDocument());
    expect(screen.getByLabelText(/Venue flows to Sky and Spark/)).toBeInTheDocument();
    expect(screen.getAllByText("SparkLend USDS").length).toBeGreaterThan(0);
    expect(screen.getByText("synthetic")).toBeInTheDocument();
    expect(screen.getByText(/Headline prime-agent revenue is \$100 above/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "2026-07 source" })).toHaveAttribute(
      "href",
      "https://github.com/soterlabs/settlement-reports/tree/main/reports/spark/2026-07",
    );
  });

  it("switches month from the bar control", async () => {
    render(<ActorSettlements slug="spark" name="Spark" />);
    await waitFor(() => screen.getByText("Kept by Spark"));
    fireEvent.click(screen.getByRole("button", { name: /Jun 2026/ }));
    expect(screen.getAllByText("June venue").length).toBeGreaterThan(0);
    expect(screen.queryByText("SparkLend USDS")).not.toBeInTheDocument();
  });

  it("explains when a prime has reports but no venue-level PnL", async () => {
    render(<ActorSettlements slug="keel" name="Keel" />);
    await waitFor(() => screen.getByText(/no venue-level PnL for Keel/));
    expect(screen.queryByLabelText(/Venue flows/)).not.toBeInTheDocument();
    expect(screen.getByText("Demand-side")).toBeInTheDocument();
    expect(screen.getByText("$36,231")).toBeInTheDocument();
    expect(screen.getByText("Agent rate")).toBeInTheDocument();
    expect(screen.getByText("$32,004")).toBeInTheDocument();
    expect(screen.getByText("Distribution rewards")).toBeInTheDocument();
    expect(screen.getByText("$4,227")).toBeInTheDocument();
    expect(screen.queryByText("To Sky")).not.toBeInTheDocument();
    expect(screen.queryByText("Kept by Keel")).not.toBeInTheDocument();
    expect(screen.getByText(/Sky's take is zero/)).toBeInTheDocument();
  });

  it("resolves Spark's workbooks from the composite-party slug", async () => {
    window.history.pushState({}, "", "/radar/spark-party/settlements");
    render(<ActorSettlements slug="spark-party" name="Spark" />);
    await waitFor(() => expect(screen.getByText("Kept by Spark")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "2026-07 source" })).toHaveAttribute(
      "href",
      "https://github.com/soterlabs/settlement-reports/tree/main/reports/spark/2026-07",
    );
  });

  it("explains when a slug has no MSC workbooks", async () => {
    const { rerender } = render(<ActorSettlements slug="spark" name="Spark" />);
    await screen.findByText("Kept by Spark");
    rerender(<ActorSettlements slug="spark-proxy" name="Spark Proxy" />);
    expect(screen.getByText(/No published Monthly Settlement Cycle workbooks for Spark Proxy/)).toBeInTheDocument();
  });
});
