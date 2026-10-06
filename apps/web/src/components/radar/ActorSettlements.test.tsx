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
    expect(screen.getByText(/^Supply-side kept by /)).toBeInTheDocument();
    expect(screen.getByText("monthly summary")).toBeInTheDocument();
    expect(screen.getByText("demand side")).toBeInTheDocument();
    expect(screen.getByText("Demand-side from Sky to Spark")).toBeInTheDocument();
    expect(screen.getByText(/Spark sent/)).toBeInTheDocument();
    expect(skeleton.querySelectorAll(".msc-bar-cluster")).toHaveLength(6);
    expect(skeleton.querySelectorAll(".msc-bar-stack")).toHaveLength(6);
  });

  it("renders Spark figures, the settlement streams, and the venue table for the latest month", async () => {
    render(<ActorSettlements slug="spark" name="Spark" />);
    await waitFor(() => expect(screen.getByText(/^Supply-side kept by /)).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "monthly summary" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "demand side" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Trailing 2 Months – Spark sent $110 to Sky, kept $162 supply-side, received $75 demand-side from Sky" })).toBeInTheDocument();
    const panes = document.querySelectorAll(".msc-charts-pane");
    expect(panes).toHaveLength(2);
    expect(panes[0]).toContainElement(screen.getByLabelText("Settlement months"));
    expect(panes[1]).toContainElement(screen.getByLabelText("Demand-side months"));
    const legends = document.querySelectorAll(".msc-charts-legend");
    expect(legends[0]).toHaveTextContent("to Sky");
    expect(legends[0]).toHaveTextContent("supply-side kept");
    expect(legends[0]).toHaveTextContent("demand-side");
    expect(legends[0]).not.toHaveTextContent("agent rate");
    expect(legends[1]).toHaveTextContent("agent rate");
    expect(legends[1]).toHaveTextContent("distribution rewards");
    expect(legends[1].querySelector(".msc-bar-rate")).toBeInTheDocument();
    expect(legends[0].querySelector(".msc-bar-demand")).toBeInTheDocument();
    expect(screen.getByLabelText(/Settlement flows between Spark and Sky/)).toBeInTheDocument();
    // Sky's name links back to the ecosystem overview for this month.
    expect(
      screen.getByRole("link", { name: /ecosystem Monthly Settlement Cycle overview/ }),
    ).toHaveAttribute("href", "/radar?msc=2026-07");
    expect(screen.getAllByText("SparkLend USDS").length).toBeGreaterThan(0);
    expect(screen.getAllByText("synthetic").length).toBeGreaterThan(0);
    // Revenue no venue row carries is its own row, so the table reaches the card.
    expect(screen.getAllByText("Prime-level (no venue)").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Headline prime-agent revenue is/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "2026-07 source" })).toHaveAttribute(
      "href",
      "https://github.com/soterlabs/settlement-reports/tree/main/reports/spark/2026-07",
    );
    expect(screen.getByRole("group", { name: "Venue view" })).toBeInTheDocument();
    const pnl = screen.getByRole("button", { name: "Settlement flows" });
    const aum = screen.getByRole("button", { name: "Assets Under Management" });
    expect(pnl).toHaveAttribute("aria-pressed", "true");
    expect(aum).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(aum);
    expect(pnl).toHaveAttribute("aria-pressed", "false");
    expect(aum).toHaveAttribute("aria-pressed", "true");
    // The choice lives in the URL; the flows are the default and clear it.
    expect(window.location.search).toContain("venues=aum");
    expect(screen.getByText("Venue AUM (end of month)")).toBeInTheDocument();
    expect(screen.getByText("$753.00M")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Settlement flows between/)).not.toBeInTheDocument();
    // Rows carry the key the reorder animation slides them by.
    expect(document.querySelectorAll(".msc-aum-row[data-flip-key]").length).toBeGreaterThan(0);
    fireEvent.click(pnl);
    expect(window.location.search).not.toContain("venues=");
  });

  it("shows the To Sky equation card headed by the month, and draws what stays with the Prime supply-side green", async () => {
    const { container } = render(<ActorSettlements slug="spark" name="Spark" />);
    await waitFor(() => screen.getByLabelText("To Sky equals cost of funds plus Sky Direct Exposure"));
    expect(screen.getByText("cost of funds")).toBeInTheDocument();
    expect(screen.getByText("Sky Direct Exposure")).toBeInTheDocument();
    // The prime side is its own equation, named for the Prime: kept 150 + demand 70.
    expect(screen.getByLabelText(/^Supply-side kept by Spark, and demand-side owed by Sky to Spark/)).toBeInTheDocument();
    expect(screen.getByText("Demand-side from Sky to Spark")).toBeInTheDocument();
    expect(screen.getByText(/^Supply-side kept by /)).toBeInTheDocument();
    // Each side keeps its own figure: kept 150, demand 70, never a $220 total.
    expect(screen.getAllByText("$150").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$70").length).toBeGreaterThan(0);
    expect(screen.queryByText("$220")).not.toBeInTheDocument();
    // The card is headed by the settlement month, not the Prime's name.
    const headline = screen.getByLabelText("To Sky equals cost of funds plus Sky Direct Exposure").closest(".msc-card")!;
    expect(headline).toHaveTextContent(/^▶ play\s*Jul 2026/);
    // The month charts sit in their own card ABOVE the figures.
    const charts = screen.getByRole("heading", { name: "monthly summary" }).closest(".msc-card")!;
    expect(charts).toContainElement(screen.getByLabelText("Demand-side months"));
    expect(charts.compareDocumentPosition(headline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: /Play through the months/ })).toBeInTheDocument();
    // No identity swatch on the card; what stays with the Prime is supply-side green.
    expect(container.querySelector(".msc-identity-swatch")).toBeNull();
    expect(container.querySelector(".msc-arc-band[data-key$=':kept'] .msc-arc-body[stroke='var(--msc-kept)']")).toBeInTheDocument();
    expect(container.querySelector("[fill='var(--msc-prime-1)'], [stroke='var(--msc-prime-1)']")).not.toBeInTheDocument();
  });

  it("switches month from the bar control", async () => {
    render(<ActorSettlements slug="spark" name="Spark" />);
    await waitFor(() => screen.getByText(/^Supply-side kept by /));
    fireEvent.click(screen.getByRole("button", { name: /Jun 2026: \$10 to Sky/ }));
    expect(screen.getAllByText("June venue").length).toBeGreaterThan(0);
    expect(screen.queryByText("SparkLend USDS")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Settlement flows between Spark and Sky/)).toBeInTheDocument();
  });

  it("charts demand-side mix and the three-way summary for Keel", async () => {
    render(<ActorSettlements slug="keel" name="Keel" />);
    await waitFor(() => screen.getByText("Demand-side from Sky to Keel"));
    // A demand-only Prime still has its flows: the lane back from Sky.
    expect(screen.getByLabelText(/Settlement flows between Keel and Sky/)).toBeInTheDocument();
    expect(document.querySelectorAll(".msc-arc-band").length).toBe(2);
    expect(document.querySelector(".msc-arc-band[data-venue]")).toBeNull();
    expect(screen.getByText("To Sky")).toBeInTheDocument();
    expect(screen.getByText(/^Supply-side kept by /)).toBeInTheDocument();
    expect(screen.getByText("Demand-side from Sky to Keel")).toBeInTheDocument();
    expect(screen.getAllByText("$36,231").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Demand-side months")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Trailing 1 Month – Keel sent $0 to Sky, kept $0 supply-side, received $36,231 demand-side from Sky" })).toBeInTheDocument();
    expect(screen.getByText("agent rate")).toBeInTheDocument();
    expect(screen.getByText("distribution rewards")).toBeInTheDocument();
  });

  it("draws a single-venue Prime's flows, with its AUM a click away", async () => {
    render(<ActorSettlements slug="obex" name="Obex" />);
    await waitFor(() => screen.getAllByText("Maple syrupUSDC"));
    expect(screen.getByLabelText(/Settlement flows between Obex and Sky/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Assets Under Management" }));
    expect(screen.getByText("Venue AUM (end of month)")).toBeInTheDocument();
    expect(screen.getByText("$402.00M")).toBeInTheDocument();
  });

  it("tags venue stripes, their labels and table rows with matching data-venue ids, and links cited figures", async () => {
    render(<ActorSettlements slug="spark" name="Spark" />);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    const row = screen.getByRole("cell", { name: /SparkLend USDS/ }).closest("tr")!;
    expect(row).toHaveAttribute("data-venue", "S1");
    expect(document.querySelector('.msc-arc-band[data-venue="S1"]')).toBeInTheDocument();
    expect(document.querySelector('.msc-arc-venue-label[data-venue="S1"]')).toBeInTheDocument();
    expect(document.querySelector('.msc-arc-link[href$="id=e98ddd17-a8c3-4523-8464-cc41247c66e8"]')).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "CoF to Sky" })).toHaveAttribute("href", expect.stringContaining("6b2b7302-e63b-457e-afeb-daab5ca7a7de"));
  });

  it("resolves Spark's workbooks from the composite-party slug", async () => {
    window.history.pushState({}, "", "/radar/spark-party/settlements");
    render(<ActorSettlements slug="spark-party" name="Spark" />);
    await waitFor(() => expect(screen.getByText(/^Supply-side kept by /)).toBeInTheDocument());
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
    await waitFor(() => screen.getByText(/^Supply-side kept by /));
    expect(screen.getByRole("heading", { name: /Trailing 12 Months – Spark sent/ })).toBeInTheDocument();
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
    await screen.findByText(/^Supply-side kept by /);
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
