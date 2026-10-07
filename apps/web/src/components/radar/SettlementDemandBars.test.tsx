// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { act } from "react";
import { SettlementDemandBars } from "./SettlementDemandBars";
import { DEMAND_SERIES, type SettlementReport } from "../../lib/settlements";

const HEADLINE = {
  primeAgentRevenue: 0,
  skyRevenue: 0,
  profitToGrove: 0,
  cof: 0,
  sdeRevenue: 0,
};

function report(
  month: string,
  over: Partial<SettlementReport["headline"]>,
): SettlementReport {
  return {
    prime: "spark",
    month,
    settleVersion: "0.4.0",
    generatedAt: null,
    period: null,
    headline: { ...HEADLINE, ...over },
    venues: [],
  };
}

const SERIES = DEMAND_SERIES.filter(
  (s) => s.key === "agentRate" || s.key === "distributionRewards",
);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("SettlementDemandBars", () => {
  it("does not show a tooltip until a segment is hovered", () => {
    render(
      <SettlementDemandBars
        reports={[report("2026-07", { agentRate: 50, distributionRewards: 20 })]}
        series={SERIES}
        selected="2026-07"
        onSelect={() => {}}
      />,
    );
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows the hovered segment's series label and amount", () => {
    render(
      <SettlementDemandBars
        reports={[report("2026-07", { agentRate: 50, distributionRewards: 20 })]}
        series={SERIES}
        selected="2026-07"
        onSelect={() => {}}
      />,
    );
    const stack = document.querySelector(".msc-bar-stack")!;
    fireEvent.mouseEnter(stack.querySelector(".msc-bar-rate")!);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole("tooltip")).toHaveTextContent("Agent rate $50");

    fireEvent.mouseLeave(stack.querySelector(".msc-bar-rate")!);
    fireEvent.mouseEnter(stack.querySelector(".msc-bar-dr")!);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole("tooltip")).toHaveTextContent("Distribution rewards $20");
  });
});
