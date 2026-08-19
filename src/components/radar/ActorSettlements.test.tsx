// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { SettlementsBundle } from "../../lib/settlements";

const venue = (
  over: Partial<SettlementsBundle["reports"][0]["venues"][0]> & { id: string; label: string },
) => ({
  chain: "ethereum",
  synthetic: false,
  revenueToPrime: 0,
  cofAlloc: 0,
  profitToSky: 0,
  profitToGrove: 0,
  valueEom: 0,
  ...over,
});

const FIXTURE: SettlementsBundle = {
  source: { repo: "soterlabs/settlement-reports" },
  reports: [
    {
      prime: "spark",
      month: "2026-06",
      settleVersion: "0.4.0",
      generatedAt: null,
      period: null,
      headline: {
        primeAgentRevenue: 20, skyRevenue: 10, profitToGrove: 5, cof: 8, sdeRevenue: 2,
        agentRate: 5,
      },
      venues: [
        venue({
          id: "S1", label: "June venue",
          revenueToPrime: 20, cofAlloc: 8, profitToSky: 10, profitToGrove: 5, valueEom: 12_000_000,
        }),
      ],
    },
    {
      prime: "spark",
      month: "2026-07",
      settleVersion: "0.4.0",
      generatedAt: null,
      period: null,
      headline: {
        primeAgentRevenue: 200, skyRevenue: 100, profitToGrove: 40, cof: 50, sdeRevenue: 50,
        agentRate: 50, distributionRewards: 20,
      },
      venues: [
        venue({
          id: "S1", label: "SparkLend USDS",
          revenueToPrime: 90, cofAlloc: 50, profitToSky: 60, profitToGrove: 30, valueEom: 753_000_000,
        }),
        venue({
          id: "SPREAD", label: "Spread", chain: "", synthetic: true,
          revenueToPrime: 10, profitToSky: 40, profitToGrove: 10,
        }),
      ],
    },
    {
      prime: "keel",
      month: "2026-07",
      settleVersion: "0.4.0",
      generatedAt: null,
      period: null,
      headline: {
        primeAgentRevenue: 0, skyRevenue: 0, profitToGrove: 0, cof: 0, sdeRevenue: 0,
        agentRate: 32004, distributionRewards: 4227, primeAgentTotalRevenue: 36231,
      },
      venues: [],
    },
    {
      prime: "obex",
      month: "2026-07",
      settleVersion: "0.4.0",
      generatedAt: null,
      period: null,
      headline: {
        primeAgentRevenue: 250, skyRevenue: 176, profitToGrove: 76, cof: 176, sdeRevenue: 0,
        agentRate: 72,
      },
      venues: [
        venue({
          id: "V1", label: "Maple syrupUSDC",
          revenueToPrime: 250, cofAlloc: 176, profitToSky: 176, profitToGrove: 76, valueEom: 402_000_000,
        }),
      ],
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
    await waitFor(() => expect(screen.getByText("Supply kept")).toBeInTheDocument());
    expect(screen.getByLabelText(/Venue flows to Sky and Spark/)).toBeInTheDocument();
    expect(screen.getAllByText("SparkLend USDS").length).toBeGreaterThan(0);
    expect(screen.getByText("synthetic")).toBeInTheDocument();
    expect(screen.getByText(/Headline prime-agent revenue is \$100 above/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "2026-07 source" })).toHaveAttribute(
      "href",
      "https://github.com/soterlabs/settlement-reports/tree/main/reports/spark/2026-07",
    );
    expect(screen.getByRole("group", { name: "Venue view" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "AUM" }));
    expect(screen.getByText("Venue AUM (end of month)")).toBeInTheDocument();
    expect(screen.getByText("$753.00M")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Venue flows/)).not.toBeInTheDocument();
  });

  it("switches month from the bar control", async () => {
    render(<ActorSettlements slug="spark" name="Spark" />);
    await waitFor(() => screen.getByText("Supply kept"));
    fireEvent.click(screen.getByRole("button", { name: /Jun 2026: \$10 to Sky/ }));
    expect(screen.getByText("June venue")).toBeInTheDocument();
    expect(screen.queryByText("SparkLend USDS")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Venue flows/)).not.toBeInTheDocument();
  });

  it("charts demand-side mix and the three-way summary for Keel", async () => {
    render(<ActorSettlements slug="keel" name="Keel" />);
    await waitFor(() => screen.getByText(/no venue-level PnL for Keel/));
    expect(screen.queryByLabelText(/Venue flows/)).not.toBeInTheDocument();
    expect(screen.getByText("To Sky")).toBeInTheDocument();
    expect(screen.getByText("Supply kept")).toBeInTheDocument();
    expect(screen.getAllByText("Demand-side").length).toBeGreaterThan(0);
    expect(screen.getByText("$36,231")).toBeInTheDocument();
    expect(screen.getByLabelText("Demand-side months")).toBeInTheDocument();
    expect(screen.getByText("agent rate")).toBeInTheDocument();
    expect(screen.getByText("distribution rewards")).toBeInTheDocument();
    expect(screen.getByText(/Sky's take is zero/)).toBeInTheDocument();
  });

  it("hides the Sankey when only one venue has PnL and shows AUM instead", async () => {
    render(<ActorSettlements slug="obex" name="Obex" />);
    await waitFor(() => screen.getByText("Maple syrupUSDC"));
    expect(screen.queryByLabelText(/Venue flows/)).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Venue view" })).not.toBeInTheDocument();
    expect(screen.getByText("Venue AUM (end of month)")).toBeInTheDocument();
    expect(screen.getByText("$402.00M")).toBeInTheDocument();
  });

  it("tags sankey flows and venue table rows with matching data-venue ids", async () => {
    render(<ActorSettlements slug="spark" name="Spark" />);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    const row = screen.getByRole("cell", { name: /SparkLend USDS/ }).closest("tr")!;
    expect(row).toHaveAttribute("data-venue", "S1");
    expect(document.querySelector('.msc-sankey-link[data-venue="S1"]')).toBeInTheDocument();
    expect(document.querySelector('.msc-sankey-venue[data-venue="S1"]')).toBeInTheDocument();
  });

  it("resolves Spark's workbooks from the composite-party slug", async () => {
    window.history.pushState({}, "", "/radar/spark-party/settlements");
    render(<ActorSettlements slug="spark-party" name="Spark" />);
    await waitFor(() => expect(screen.getByText("Supply kept")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "2026-07 source" })).toHaveAttribute(
      "href",
      "https://github.com/soterlabs/settlement-reports/tree/main/reports/spark/2026-07",
    );
  });

  it("explains when a slug has no MSC workbooks", async () => {
    const { rerender } = render(<ActorSettlements slug="spark" name="Spark" />);
    await screen.findByText("Supply kept");
    rerender(<ActorSettlements slug="spark-proxy" name="Spark Proxy" />);
    expect(screen.getByText(/No published Monthly Settlement Cycle workbooks for Spark Proxy/)).toBeInTheDocument();
  });
});
