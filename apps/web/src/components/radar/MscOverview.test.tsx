// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { SettlementReport, SettlementsBundle } from "../../lib/settlements";

const report = (
  over: Omit<Partial<SettlementReport>, "headline"> & {
    headline?: Partial<SettlementReport["headline"]>;
  },
): SettlementReport => ({
  prime: "spark",
  month: "2026-07",
  settleVersion: null,
  generatedAt: null,
  period: null,
  venues: [],
  ...over,
  headline: {
    primeAgentRevenue: 200, skyRevenue: 100, profitToGrove: 40, cof: 60, sdeRevenue: 40,
    agentRate: 50,
    ...over.headline,
  },
});

const FIXTURE: SettlementsBundle = {
  source: { repo: "soterlabs/settlement-reports" },
  reports: [
    report({ month: "2026-06", headline: { primeAgentRevenue: 20, skyRevenue: 10, cof: 8, sdeRevenue: 2, agentRate: 5 } }),
    report({}),
    // Demand-only prime with no matching actor in the roster below.
    report({ prime: "keel", headline: { primeAgentRevenue: 0, skyRevenue: 0, cof: 0, sdeRevenue: 0, agentRate: 32_004 } }),
  ],
};

const loadSettlements = vi.hoisted(() => vi.fn());
const track = vi.hoisted(() => vi.fn());

vi.mock("../../lib/settlements", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/settlements")>();
  return { ...actual, loadSettlements: () => loadSettlements() };
});
vi.mock("../../lib/analytics", () => ({ track: (...a: unknown[]) => track(...a) }));

import { MscOverview } from "./MscOverview";
import { EMPTY_SETTLEMENTS } from "../../lib/settlements";

const ACTORS = [{ slug: "spark-party", name: "Spark" }];

afterEach(() => {
  cleanup();
  window.history.pushState({}, "", "/radar");
});

beforeEach(() => {
  loadSettlements.mockReset();
  loadSettlements.mockResolvedValue(FIXTURE);
  track.mockReset();
  window.history.pushState({}, "", "/radar");
});

describe("MscOverview", () => {
  it("renders the ring, disclaimer, and ecosystem headline row for the latest month", async () => {
    render(<MscOverview actors={ACTORS} />);
    await waitFor(() => expect(screen.getByText("Monthly Settlement Cycle")).toBeInTheDocument());
    expect(screen.getByLabelText("Monthly Settlement Cycle flows for Jul 2026")).toBeInTheDocument();
    expect(screen.getByText(/not the Protocol's Net Revenue/)).toBeInTheDocument();
    expect(screen.getByText(/indicates loss \/ negative flow/)).toBeInTheDocument();
    // Cross-chart hover styles: one :has() rule per prime in the stack.
    const style = document.querySelector("style")!.textContent!;
    expect(style).toContain('.msc-ts-seg[data-prime="spark"]:hover');
    expect(style).toContain('.msc-ring-prime[data-prime="spark"]');
    expect(screen.getByText("To Sky")).toBeInTheDocument();
    expect(screen.getByText("of which cost of funds")).toBeInTheDocument();
    expect(screen.getByText("of which Sky Direct Exposure")).toBeInTheDocument();
    expect(screen.getByText("Supply kept by Primes")).toBeInTheDocument();
    expect(screen.getByText("Demand-side by Primes")).toBeInTheDocument();
    // eco sky = 100; eco kept = (200-60) + 0 = 140; demand = 50 + 32004.
    // "$140" also rides the ring's hover amounts, so match all.
    expect(screen.getAllByText("$140").length).toBeGreaterThan(0);
    expect(track).toHaveBeenCalledWith("msc_overview_view", { month: "2026-07", primes: 2 });
    expect(track).toHaveBeenCalledTimes(1);
  });

  it("selects a month from the timeseries and syncs ?msc (latest month clears it)", async () => {
    render(<MscOverview actors={ACTORS} />);
    await waitFor(() => screen.getByText("Prime-side earnings by month"));
    fireEvent.click(screen.getByRole("button", { name: /Jun 2026: .*\$10 to Sky/ }));
    expect(window.location.search).toBe("?msc=2026-06");
    expect(screen.getByLabelText("Monthly Settlement Cycle flows for Jun 2026")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Jul 2026: .*to Sky/ }));
    expect(window.location.search).toBe("");
  });

  it("honors an incoming ?msc and falls back to latest on an unknown month", async () => {
    window.history.pushState({}, "", "/radar?msc=2026-06");
    render(<MscOverview actors={ACTORS} />);
    await waitFor(() =>
      expect(screen.getByLabelText("Monthly Settlement Cycle flows for Jun 2026")).toBeInTheDocument(),
    );
    cleanup();
    window.history.pushState({}, "", "/radar?msc=1999-01");
    render(<MscOverview actors={ACTORS} />);
    await waitFor(() =>
      expect(screen.getByLabelText("Monthly Settlement Cycle flows for Jul 2026")).toBeInTheDocument(),
    );
  });

  it("renders nothing while loading and when the artifact is missing", async () => {
    loadSettlements.mockReturnValue(new Promise(() => {}));
    const { container } = render(<MscOverview actors={ACTORS} />);
    expect(container).toBeEmptyDOMElement();
    cleanup();

    loadSettlements.mockResolvedValue(EMPTY_SETTLEMENTS);
    const { container: c2 } = render(<MscOverview actors={ACTORS} />);
    await waitFor(() => expect(loadSettlements).toHaveBeenCalled());
    expect(c2).toBeEmptyDOMElement();
    expect(track).not.toHaveBeenCalled();
  });
});
