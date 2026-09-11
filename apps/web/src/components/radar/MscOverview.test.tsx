// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
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
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith("msc_overview_view", { month: "2026-07", primes: 2 }),
    );
    expect(screen.getByLabelText("Monthly Settlement Cycle flows for Jul 2026")).toBeInTheDocument();
    expect(screen.getByText(/not the Protocol's Net Revenue/)).toBeInTheDocument();
    expect(screen.getByText(/supply-side loss \(the hole\)/)).toBeInTheDocument();
    // No "kept · supply kept" — a row carries a code only when it adds one.
    expect(screen.getByText("supply-side kept")).toBeInTheDocument();
    // The key is grouped by where the money goes, in the pie's order.
    const key = document.querySelector(".msc-key")!;
    const groups = [...key.querySelectorAll(".msc-key-group")].map((g) => ({
      title: g.querySelector(".msc-key-title")!.textContent,
      keys: [...g.querySelectorAll(".msc-key-item")].map((i) => i.getAttribute("data-key")),
    }));
    expect(groups).toEqual([
      { title: "To Sky", keys: ["cof", "sde"] },
      { title: "Supply-side", keys: ["kept", "neg"] },
      { title: "Demand-side", keys: ["agentRate", "distributionRewards", "gar", "chroniclePoints"] },
    ]);
    expect(document.querySelector(".msc-key-note")).toHaveTextContent("Pie area = gross revenue*");
    // Cross-chart hover styles: one :has() rule per prime in the stack.
    const style = document.querySelector("style")!.textContent!;
    expect(style).toContain('.msc-bar-col[data-active="true"] .msc-ts-seg[data-prime="spark"][data-flow="sky"]:hover');
    expect(style).not.toContain('[data-flow="kept"]');
    expect(style).toContain('.msc-ring-prime[data-prime="spark"]');
    // …and back: the ring's marks light the matching layer, and the
    // month's other primes fade while a pie is in focus.
    expect(style).toContain('.msc-ring-mark[data-mark="spark::sky"]:hover');
    expect(style).toContain('.msc-bar-col[data-active="true"] .msc-ts-seg:not([data-prime="spark"]) { opacity: 0.22; }');
    expect(screen.getAllByText("To Sky").length).toBeGreaterThanOrEqual(1); // headline card + donut center
    // Headline card reads as the equation it is.
    expect(screen.getByLabelText("To Sky equals cost of funds plus Sky Direct Exposure")).toBeInTheDocument();
    expect(screen.getByText("cost of funds")).toBeInTheDocument();
    expect(screen.getByText("Sky Direct Exposure")).toBeInTheDocument();
    expect(screen.getByText("Supply-side kept by Primes")).toBeInTheDocument();
    expect(screen.getByText("Demand-side to Primes")).toBeInTheDocument();
    // eco sky = 100; eco kept = (200-60) + 0 = 140; demand = 50 + 32004.
    // "$140" also rides the ring's hover amounts, so match all.
    expect(screen.getAllByText("$140").length).toBeGreaterThan(0);
    expect(track).toHaveBeenCalledTimes(1);
  });

  it("opens paused on the latest month; play steps through the months until a month is clicked", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<MscOverview actors={ACTORS} />);
      await waitFor(() => screen.getByText("To Sky by month, per Prime"));
      expect(screen.getByLabelText("Monthly Settlement Cycle flows for Jul 2026")).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2500);
      });
      // Still July: nothing plays on its own.
      expect(screen.getByLabelText("Monthly Settlement Cycle flows for Jul 2026")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /Play through the months/ }));
      expect(screen.getByRole("button", { name: "Pause the month autoplay" })).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      // Two months in the fixture: Jul → Jun.
      expect(screen.getByLabelText("Monthly Settlement Cycle flows for Jun 2026")).toBeInTheDocument();
      // A click stops it.
      fireEvent.click(screen.getByRole("button", { name: /Jul 2026: .*to Sky/ }));
      expect(screen.getByRole("button", { name: /Play through the months/ })).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4000);
      });
      expect(screen.getByLabelText("Monthly Settlement Cycle flows for Jul 2026")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("switches between the orbital pies and the flow chart, synced to ?view", async () => {
    const { container } = render(<MscOverview actors={ACTORS} />);
    await waitFor(() => screen.getByText("Monthly Settlement Cycle"));
    const group = screen.getByRole("group", { name: "Chart style" });
    const orbit = screen.getByRole("button", { name: "orbit" });
    const flowBtn = screen.getByRole("button", { name: "flow" });
    expect(group).toContainElement(orbit);
    expect(orbit).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelector("svg.msc-flow")).not.toBeInTheDocument();
    expect(screen.getByText(/supply-side loss \(the hole\)/)).toBeInTheDocument();
    fireEvent.click(flowBtn);
    expect(window.location.search).toBe("?view=flow");
    expect(flowBtn).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelector("svg.msc-flow")).toBeInTheDocument();
    expect(container.querySelector(".msc-ring-sky-disc")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Monthly Settlement Cycle flows for Jul 2026")).toBeInTheDocument();
    // The key's loss row and reading guide describe the chart on screen.
    expect(screen.getByText(/^striped · supply-side loss$/)).toBeInTheDocument();
    expect(document.querySelector(".msc-key-note")).toHaveTextContent("A Prime's bar = gross revenue*");
    expect(track).toHaveBeenCalledWith("msc_overview_style", { view: "flow" });
    fireEvent.click(orbit);
    expect(window.location.search).toBe("");
    expect(container.querySelector("svg.msc-flow")).not.toBeInTheDocument();
  });

  it("selects a month from the timeseries and syncs ?msc (latest month clears it)", async () => {
    render(<MscOverview actors={ACTORS} />);
    await waitFor(() => screen.getByText("To Sky by month, per Prime"));
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
