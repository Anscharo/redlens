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
import { fulfilled } from "../../test/fulfilled";

const ACTORS = [{ slug: "spark-party", name: "Spark" }];

afterEach(() => {
  cleanup();
  window.history.pushState({}, "", "/radar");
});

beforeEach(() => {
  loadSettlements.mockReset();
  // use() reads the mocked loader every render: a pre-fulfilled promise (see fulfilled.ts).
  loadSettlements.mockReturnValue(fulfilled(FIXTURE));
  track.mockReset();
  window.history.pushState({}, "", "/radar");
});

describe("MscOverview", () => {
  it("shows the same cards, empty and full-size, while the settlements load", async () => {
    loadSettlements.mockReturnValue(new Promise(() => {}));
    render(<MscOverview actors={ACTORS} />);
    const skeleton = screen.getByTestId("msc-overview-skeleton");
    expect(screen.getByText("Monthly Settlement Cycle")).toBeInTheDocument();
    // The headline card keeps its labels; every figure is a dash.
    expect(screen.getByLabelText("To Sky equals cost of funds plus Sky Direct Exposure")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Supply-side kept by Primes, and demand-side owed by Sky to Primes/)).toBeInTheDocument();
    expect(screen.getByText("Supply-side kept by Primes")).toBeInTheDocument();
    expect(skeleton.querySelectorAll(".msc-card")).toHaveLength(3);
    // The timeseries track and the flow canvas are already their real sizes.
    expect(skeleton.querySelector(".msc-ts-grid")).toHaveAttribute("height", "380");
    expect(skeleton.querySelector("svg.msc-flow")).toHaveAttribute("viewBox", "0 0 3000 1200");
    expect(skeleton.querySelector(".msc-flow-header")).toHaveTextContent("SOURCE");
    expect(screen.getByRole("group", { name: "Chart style" })).toBeInTheDocument();
    expect(document.querySelector(".msc-key")).toBeInTheDocument();
  });

  it("renders the ring, disclaimer, and ecosystem headline row for the latest month", async () => {
    render(<MscOverview actors={ACTORS} />);
    await waitFor(() => expect(screen.getByText("Monthly Settlement Cycle")).toBeInTheDocument());
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith("msc_overview_view", { month: "2026-07", primes: 2 }),
    );
    expect(screen.getByLabelText("Monthly Settlement Cycle flows for Jul 2026")).toBeInTheDocument();
    expect(screen.getByText(/not the Protocol's Net Revenue/)).toBeInTheDocument();
    expect(screen.getByText(/^striped · supply-side loss$/)).toBeInTheDocument();
    // No "kept · supply kept" — a row carries a code only when it adds one.
    expect(screen.getAllByText("supply-side kept").length).toBeGreaterThanOrEqual(1); // key row + flow source label
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
    expect(document.querySelector(".msc-key-note")).toHaveTextContent("A Prime's bar = gross revenue*");
    // Cross-chart hover styles: one :has() rule per prime in the stack.
    const style = document.querySelector("style")!.textContent!;
    expect(style).toContain('.msc-bar-col[data-active="true"] .msc-ts-seg[data-prime="spark"][data-flow="sky"]:hover');
    expect(style).not.toContain('[data-flow="kept"]');
    expect(style).toContain('.msc-ring-prime[data-prime="spark"]');
    // …and back: the ring's marks light the matching layer, and the
    // month's other primes fade while a pie is in focus.
    expect(style).toContain('.msc-ring-mark[data-mark="spark::sky"]:hover');
    expect(style).toContain('.msc-bar-col[data-active="true"] .msc-ts-seg:not([data-prime="spark"]) { opacity: 0.5; }');
    expect(screen.getAllByText("To Sky").length).toBeGreaterThanOrEqual(1); // headline card + donut center
    // Headline card reads as the equation it is.
    expect(screen.getByLabelText("To Sky equals cost of funds plus Sky Direct Exposure")).toBeInTheDocument();
    expect(screen.getByText("cost of funds")).toBeInTheDocument();
    expect(screen.getByText("Sky Direct Exposure")).toBeInTheDocument();
    // The prime side reads as its own equation, the way To Sky does.
    expect(screen.getByLabelText(/^Supply-side kept by Primes, and demand-side owed by Sky to Primes/)).toBeInTheDocument();
    expect(screen.getByText("Supply-side kept by Primes")).toBeInTheDocument();
    // Also the chart key's group heading, hence getAllByText.
    expect(screen.getAllByText("Demand-side").length).toBeGreaterThan(0);
    // eco sky = 100; eco kept = (200-60) + 0 = 140; demand = 50 + 32004.
    // "$140" also rides the ring's hover amounts, so match all.
    expect(screen.getAllByText("$140").length).toBeGreaterThan(0);
    // The demand side is its own figure, never added to the 140: 50 + 32,004.
    expect(screen.getByText("$32,054")).toBeInTheDocument();
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
      // Pressing play moves a month AT ONCE — a dwell of nothing first reads
      // as a dead button. Two months in the fixture: Jul → Jun, no timers.
      expect(screen.getByLabelText("Monthly Settlement Cycle flows for Jun 2026")).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      // Then a full dwell each month, wrapping: Jun → Jul.
      expect(screen.getByLabelText("Monthly Settlement Cycle flows for Jul 2026")).toBeInTheDocument();
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

  it("steps a month back and forward on the arrow keys, without wrapping or stealing typed arrows", async () => {
    render(<MscOverview actors={ACTORS} />);
    await waitFor(() => screen.getByLabelText("Monthly Settlement Cycle flows for Jul 2026"));
    fireEvent.keyDown(document, { key: "ArrowRight" }); // already the latest: stays
    expect(screen.getByLabelText("Monthly Settlement Cycle flows for Jul 2026")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(screen.getByLabelText("Monthly Settlement Cycle flows for Jun 2026")).toBeInTheDocument();
    expect(window.location.search).toBe("?msc=2026-06");
    fireEvent.keyDown(document, { key: "ArrowLeft" }); // first month: stays
    expect(screen.getByLabelText("Monthly Settlement Cycle flows for Jun 2026")).toBeInTheDocument();
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "ArrowRight" });
    expect(screen.getByLabelText("Monthly Settlement Cycle flows for Jun 2026")).toBeInTheDocument();
    input.remove();
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(screen.getByLabelText("Monthly Settlement Cycle flows for Jul 2026")).toBeInTheDocument();
    expect(window.location.search).toBe("");
  });

  it("puts the zoom reset in the title row, only while a chart is zoomed", async () => {
    const { container } = render(<MscOverview actors={ACTORS} />);
    await waitFor(() => screen.getByText("Monthly Settlement Cycle"));
    // At rest the row is just the title and the style pills.
    expect(screen.queryByRole("button", { name: /Reset zoom/ })).not.toBeInTheDocument();
    const svg = container.querySelector("svg.msc-flow")!;
    fireEvent.wheel(svg, { deltaY: -400 });
    const reset = screen.getByRole("button", { name: /Reset zoom/ });
    // It belongs to the card's title row, beside the style pills — not to
    // the figure it undoes.
    const titleRow = screen.getByRole("group", { name: "Chart style" }).closest("p")!;
    expect(titleRow).toContainElement(reset);
    expect(container.querySelector("figure")).not.toContainElement(reset);
    fireEvent.click(reset);
    expect(screen.queryByRole("button", { name: /Reset zoom/ })).not.toBeInTheDocument();
  });

  it("opens on the sankey and switches to the pies, synced to ?view", async () => {
    const { container } = render(<MscOverview actors={ACTORS} />);
    await waitFor(() => screen.getByText("Monthly Settlement Cycle"));
    const group = screen.getByRole("group", { name: "Chart style" });
    const pies = screen.getByRole("button", { name: "pies" });
    const sankey = screen.getByRole("button", { name: "sankey" });
    expect(group).toContainElement(pies);
    expect(sankey).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelector("svg.msc-flow")).toBeInTheDocument();
    expect(container.querySelector(".msc-ring-sky-disc")).not.toBeInTheDocument();
    fireEvent.click(pies);
    expect(window.location.search).toBe("?view=pies");
    expect(pies).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelector("svg.msc-flow")).not.toBeInTheDocument();
    expect(container.querySelector(".msc-ring-sky-disc")).toBeInTheDocument();
    expect(screen.getByLabelText("Monthly Settlement Cycle flows for Jul 2026")).toBeInTheDocument();
    // The key's loss row and reading guide describe the chart on screen.
    expect(screen.getByText(/supply-side loss \(the hole\)/)).toBeInTheDocument();
    expect(document.querySelector(".msc-key-note")).toHaveTextContent("Every pie is what that party RECEIVED");
    expect(track).toHaveBeenCalledWith("msc_overview_style", { view: "pies" });
    fireEvent.click(sankey);
    expect(window.location.search).toBe("");
    expect(container.querySelector("svg.msc-flow")).toBeInTheDocument();
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

  it("renders nothing when the artifact is missing", async () => {
    loadSettlements.mockReturnValue(fulfilled(EMPTY_SETTLEMENTS));
    const { container: c2 } = render(<MscOverview actors={ACTORS} />);
    await waitFor(() => expect(loadSettlements).toHaveBeenCalled());
    expect(c2).toBeEmptyDOMElement();
    expect(track).not.toHaveBeenCalled();
  });
});
