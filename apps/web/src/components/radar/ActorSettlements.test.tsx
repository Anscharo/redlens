// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
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

const loadSettlements = vi.hoisted(() => vi.fn());
const loadForumTopics = vi.hoisted(() => vi.fn());

vi.mock("../../lib/settlements", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/settlements")>();
  return { ...actual, loadSettlements: () => loadSettlements() };
});
vi.mock("../../lib/forumTopics", () => ({
  loadForumTopics: () => loadForumTopics(),
}));

import { ActorSettlements } from "./ActorSettlements";
import { EMPTY_SETTLEMENTS } from "../../lib/settlements";
import { fulfilled } from "../../test/fulfilled";

afterEach(() => {
  cleanup();
  window.history.pushState({}, "", "/radar/spark");
});

beforeEach(() => {
  loadSettlements.mockReset();
  // use() reads the mocked loader every render: a pre-fulfilled promise (see fulfilled.ts).
  loadSettlements.mockReturnValue(fulfilled(FIXTURE));
  loadForumTopics.mockReset();
  loadForumTopics.mockResolvedValue([]);
});

describe("ActorSettlements", () => {
  it("shows the headline card and empty bar charts at full size while the workbooks load", () => {
    loadSettlements.mockReturnValue(new Promise(() => {}));
    render(<ActorSettlements slug="spark" name="Spark" />);
    const skeleton = screen.getByTestId("settlements-skeleton");
    expect(screen.getByLabelText("To Sky equals cost of funds plus Sky Direct Exposure")).toBeInTheDocument();
    expect(screen.getByText("Supply-side kept")).toBeInTheDocument();
    expect(screen.getByText("monthly summary")).toBeInTheDocument();
    expect(screen.getByText("Demand-side")).toBeInTheDocument();
    expect(skeleton.querySelectorAll(".msc-bar-cluster")).toHaveLength(6);
    expect(skeleton.querySelectorAll(".msc-bar-stack")).toHaveLength(6);
  });

  it("renders Spark figures, the Sankey, and the venue table for the latest month", async () => {
    render(<ActorSettlements slug="spark" name="Spark" />);
    await waitFor(() => expect(screen.getByText("Supply-side kept")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "monthly summary" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Trailing 2 Months" })).toBeInTheDocument();
    expect(screen.getByText(/Agent earnings/)).toBeInTheDocument();
    expect(screen.getByText("$237")).toBeInTheDocument();
    const legend = document.querySelector(".msc-charts-legend")!;
    expect(legend).toHaveTextContent("to Sky");
    expect(legend).toHaveTextContent("supply-side kept");
    expect(legend).toHaveTextContent("demand-side");
    expect(legend).toHaveTextContent("|");
    expect(legend).toHaveTextContent("agent rate");
    expect(legend).toHaveTextContent("distribution rewards");
    expect(legend.querySelector(".msc-bar-rate")).toBeInTheDocument();
    expect(legend.querySelector(".msc-bar-demand")).toBeInTheDocument();
    expect(screen.getByLabelText(/Venue flows to Sky and Spark/)).toBeInTheDocument();
    // The Sky sink label links back to the ecosystem overview for this month.
    expect(
      screen.getByRole("link", { name: /ecosystem Monthly Settlement Cycle overview/ }),
    ).toHaveAttribute("href", "/radar?msc=2026-07");
    expect(screen.getAllByText("SparkLend USDS").length).toBeGreaterThan(0);
    expect(screen.getByText("synthetic")).toBeInTheDocument();
    expect(screen.getByText(/Headline prime-agent revenue is \$100 above/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "2026-07 source" })).toHaveAttribute(
      "href",
      "https://github.com/soterlabs/settlement-reports/tree/main/reports/spark/2026-07",
    );
    expect(screen.getByRole("group", { name: "Venue view" })).toBeInTheDocument();
    const pnl = screen.getByRole("button", { name: "Profit & Loss" });
    const aum = screen.getByRole("button", { name: "Assets Under Management" });
    expect(pnl).toHaveAttribute("aria-pressed", "true");
    expect(aum).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(aum);
    expect(pnl).toHaveAttribute("aria-pressed", "false");
    expect(aum).toHaveAttribute("aria-pressed", "true");
    // The choice lives in the URL; PnL is the default and clears it.
    expect(window.location.search).toContain("venues=aum");
    expect(screen.getByText("Venue AUM (end of month)")).toBeInTheDocument();
    expect(screen.getByText("$753.00M")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Venue flows/)).not.toBeInTheDocument();
    // Rows carry the key the reorder animation slides them by.
    expect(document.querySelectorAll(".msc-aum-row[data-flip-key]").length).toBeGreaterThan(0);
    fireEvent.click(pnl);
    expect(window.location.search).not.toContain("venues=");
  });

  it("shows the To Sky equation card headed by the month, and paints its Sankey bar supply-side green", async () => {
    const { container } = render(<ActorSettlements slug="spark" name="Spark" />);
    await waitFor(() => screen.getByLabelText("To Sky equals cost of funds plus Sky Direct Exposure"));
    expect(screen.getByText("cost of funds")).toBeInTheDocument();
    expect(screen.getByText("Sky Direct Exposure")).toBeInTheDocument();
    // Prime-side labels drop the ecosystem card's "by Primes" qualifier.
    expect(screen.getByText("Supply-side kept")).toBeInTheDocument();
    expect(screen.queryByText("Supply-side kept by Primes")).not.toBeInTheDocument();
    // The card is headed by the settlement month, not the Prime's name.
    const headline = screen.getByLabelText("To Sky equals cost of funds plus Sky Direct Exposure").closest(".msc-card")!;
    expect(headline).toHaveTextContent(/^▶ play\s*Jul 2026/);
    // The month charts sit in their own card ABOVE the figures.
    const charts = screen.getByRole("heading", { name: "monthly summary" }).closest(".msc-card")!;
    expect(charts).toContainElement(screen.getByLabelText("Demand-side months"));
    expect(charts.compareDocumentPosition(headline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: /Play through the months/ })).toBeInTheDocument();
    // No identity swatch on the card; the Sankey's Prime bar is supply-side green.
    expect(container.querySelector(".msc-identity-swatch")).toBeNull();
    expect(container.querySelector(".msc-sankey-sink rect[fill='var(--msc-kept)']")).toBeInTheDocument();
    expect(container.querySelector(".msc-sankey-sink rect[fill='var(--msc-prime-1)']")).not.toBeInTheDocument();
  });

  it("switches month from the bar control", async () => {
    render(<ActorSettlements slug="spark" name="Spark" />);
    await waitFor(() => screen.getByText("Supply-side kept"));
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
    expect(screen.getByText("Supply-side kept")).toBeInTheDocument();
    expect(screen.getAllByText("Demand-side").length).toBeGreaterThan(0);
    expect(screen.getByText("$36,231")).toBeInTheDocument();
    expect(screen.getByLabelText("Demand-side months")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Trailing 1 Months" })).toBeInTheDocument();
    expect(screen.getByText("agent rate")).toBeInTheDocument();
    expect(screen.getByText("distribution rewards")).toBeInTheDocument();
    expect(document.querySelector(".msc-charts-legend")).toHaveTextContent("|");
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
    await waitFor(() => expect(screen.getByText("Supply-side kept")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "2026-07 source" })).toHaveAttribute(
      "href",
      "https://github.com/soterlabs/settlement-reports/tree/main/reports/spark/2026-07",
    );
  });

  it("shows a year of cycles at a time, with ‹ › paging and a year row under the months", async () => {
    const run = Array.from({ length: 14 }, (_, i) => {
      const m = String(i + 1).padStart(2, "0");
      return { ...FIXTURE.reports[1], month: i < 12 ? `2025-${m}` : `2026-${String(i - 11).padStart(2, "0")}` };
    });
    loadSettlements.mockReturnValue(fulfilled({ ...FIXTURE, reports: run }));
    render(<ActorSettlements slug="spark" name="Spark" />);
    await waitFor(() => screen.getByText("Supply-side kept"));
    expect(screen.getByRole("heading", { name: "Trailing 12 Months" })).toBeInTheDocument();
    const cols = () => [...screen.getByLabelText("Settlement months").querySelectorAll("button")];
    expect(cols()).toHaveLength(12);
    expect(cols()[0]).toHaveAttribute("aria-label", expect.stringMatching(/^Mar 2025/));
    expect(cols()[11]).toHaveAttribute("aria-label", expect.stringMatching(/^Feb 2026/));
    // Twelve columns: month names on one row, the year under its first month.
    expect(cols()[0]).toHaveTextContent(/^Mar\s*2025$/);
    expect(cols()[10]).toHaveTextContent(/^Jan\s*2026$/);
    expect(cols()[11]).toHaveTextContent(/^Feb$/);
    // The demand-side chart shows the same window on the same grid.
    expect(screen.getByLabelText("Demand-side months").querySelectorAll("button")).toHaveLength(12);
    const earlier = screen.getByRole("button", { name: "Earlier cycles" });
    const later = screen.getByRole("button", { name: "Later cycles" });
    expect(later).toBeDisabled();
    fireEvent.click(earlier);
    expect(cols()[0]).toHaveAttribute("aria-label", expect.stringMatching(/^Jan 2025/));
    expect(cols()[11]).toHaveAttribute("aria-label", expect.stringMatching(/^Dec 2025/));
    expect(earlier).toBeDisabled();
    expect(later).toBeEnabled();
    // The selected (latest) month is off screen now; picking a shown one is fine.
    fireEvent.click(cols()[0]);
    expect(cols()[0]).toHaveAttribute("aria-pressed", "true");
    // Paging is explicit: it may scroll the selection off screen.
    fireEvent.click(later);
    expect(cols()[0]).toHaveAttribute("aria-label", expect.stringMatching(/^Mar 2025/));
    expect(cols().some((c) => c.getAttribute("aria-pressed") === "true")).toBe(false);
    // But moving the selection (here → from the hidden Jan to Feb 2025) brings its month back into view.
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(cols()[0]).toHaveAttribute("aria-label", expect.stringMatching(/^Jan 2025/));
    expect(cols()[1]).toHaveAttribute("aria-pressed", "true");
  });

  it("explains when a slug has no MSC workbooks", async () => {
    const { rerender } = render(<ActorSettlements slug="spark" name="Spark" />);
    await screen.findByText("Supply-side kept");
    rerender(<ActorSettlements slug="spark-proxy" name="Spark Proxy" />);
    expect(screen.getByText(/No published Monthly Settlement Cycle workbooks for Spark Proxy/)).toBeInTheDocument();
  });

  it("does not claim a prime has no workbooks when the artifact failed to load", async () => {
    loadSettlements.mockReturnValue(fulfilled(EMPTY_SETTLEMENTS));
    render(<ActorSettlements slug="spark" name="Spark" />);
    expect(await screen.findByText("Settlement figures could not be loaded.")).toBeInTheDocument();
    expect(screen.queryByText(/No published Monthly Settlement Cycle workbooks/)).not.toBeInTheDocument();
  });

  it("links Sky Forum to the thread whose title names the selected month", async () => {
    loadForumTopics.mockResolvedValue([
      { title: "MSC #10 - Settlement Summary (June 2026)", url: "https://forum.skyeco.com/t/june/10", postedAt: "2026-06-20" },
      { title: "MSC #11 - Settlement Summary (July 2026)", url: "https://forum.skyeco.com/t/july/11", postedAt: "2026-07-20" },
    ]);
    render(<ActorSettlements slug="spark" name="Spark" />);
    await waitFor(() => expect(screen.getByRole("link", { name: "Sky Forum" })).toHaveAttribute(
      "href",
      "https://forum.skyeco.com/t/july/11",
    ));
    fireEvent.click(screen.getByRole("button", { name: /Jun 2026: \$10 to Sky/ }));
    expect(screen.getByRole("link", { name: "Sky Forum" })).toHaveAttribute(
      "href",
      "https://forum.skyeco.com/t/june/10",
    );
  });
});
