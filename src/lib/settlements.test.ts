import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const fetchJson = vi.fn();
vi.mock("./verify", () => ({
  fetchJson: (...a: unknown[]) => fetchJson(...a),
}));

import {
  loadSettlements,
  resetSettlementsCache,
  reportsForPrime,
  settlementPrimeKeys,
  formatMonth,
  formatUsd,
  revenueGap,
  demandSideRevenue,
  isDemandSideCycle,
  teaserFigure,
  barPair,
  headlineFigures,
  EMPTY_SETTLEMENTS,
  type SettlementHeadline,
  type SettlementReport,
  type SettlementsBundle,
} from "./settlements";

function report(over: Partial<SettlementReport> = {}): SettlementReport {
  return {
    prime: "spark",
    month: "2026-07",
    settleVersion: "0.4.0",
    generatedAt: null,
    period: { start: "2026-07-01", end: "2026-07-31", nDays: 31 },
    headline: {
      primeAgentRevenue: 100,
      skyRevenue: 60,
      profitToGrove: 40,
      cof: 40,
      sdeRevenue: 20,
    },
    venues: [
      {
        id: "S1",
        label: "SparkLend USDS",
        chain: "ethereum",
        synthetic: false,
        revenueToPrime: 90,
        cofAlloc: 50,
        profitToSky: 50,
        profitToGrove: 40,
      },
    ],
    ...over,
  };
}

describe("formatMonth / formatUsd", () => {
  it("renders Jul 2026 from 2026-07", () => {
    expect(formatMonth("2026-07")).toBe("Jul 2026");
  });

  it("passes through a malformed stamp", () => {
    expect(formatMonth("nope")).toBe("nope");
  });

  it("formats compact millions and thousands, with a minus sign", () => {
    expect(formatUsd(1_560_000, true)).toBe("$1.56M");
    expect(formatUsd(6110, true)).toBe("$6k");
    expect(formatUsd(-42, false)).toBe("−$42");
  });
});

describe("reportsForPrime / revenueGap", () => {
  const bundle: SettlementsBundle = {
    source: { repo: "soterlabs/settlement-reports" },
    reports: [
      report({ month: "2026-06" }),
      report({ prime: "grove", month: "2026-07" }),
      report({ month: "2026-07" }),
    ],
  };

  it("returns that prime's reports oldest-first", () => {
    expect(reportsForPrime(bundle, "spark").map((r) => r.month)).toEqual(["2026-06", "2026-07"]);
    expect(reportsForPrime(bundle, "keel")).toEqual([]);
  });

  it("matches a composite-party slug and ignores case; not foundations", () => {
    expect(settlementPrimeKeys("spark-party")).toEqual(["spark-party", "spark"]);
    expect(settlementPrimeKeys("Spark")).toEqual(["spark"]);
    expect(reportsForPrime(bundle, "SPARK").map((r) => r.month)).toEqual(["2026-06", "2026-07"]);
    expect(reportsForPrime(bundle, "spark-party").map((r) => r.month)).toEqual(["2026-06", "2026-07"]);
    expect(reportsForPrime(bundle, "spark-foundation")).toEqual([]);
    expect(reportsForPrime(bundle, "grove-party")).toEqual([bundle.reports[1]]);
  });

  it("is the absolute gap between Σ revenueToPrime and the headline", () => {
    expect(revenueGap(report())).toBe(10);
    expect(revenueGap(report({ headline: { ...report().headline, primeAgentRevenue: 90 } }))).toBe(0);
  });
});

const KEEL_HEADLINE: SettlementHeadline = {
  primeAgentRevenue: 0,
  skyRevenue: 0,
  profitToGrove: 0,
  cof: 0,
  sdeRevenue: 0,
  agentRate: 32_004,
  distributionRewards: 4_227,
  chroniclePoints: 0,
  gar: 0,
  primeAgentTotalRevenue: 36_231,
};

describe("demand-side cycles", () => {
  const keel = report({
    prime: "keel",
    venues: [],
    headline: KEEL_HEADLINE,
  });
  const skybase = report({
    prime: "skybase",
    venues: [],
    headline: {
      ...KEEL_HEADLINE,
      agentRate: 37_629,
      distributionRewards: 95_303,
      gar: 105_174,
      primeAgentTotalRevenue: 238_106,
    },
  });

  it("sums agent rate and rewards, falling back to the Summary total", () => {
    expect(demandSideRevenue(KEEL_HEADLINE)).toBe(36_231);
    expect(demandSideRevenue({ ...KEEL_HEADLINE, agentRate: 0, distributionRewards: 0 })).toBe(36_231);
    expect(demandSideRevenue(report().headline)).toBe(0);
  });

  it("flags Keel/Skybase, not Spark", () => {
    expect(isDemandSideCycle(keel)).toBe(true);
    expect(isDemandSideCycle(skybase)).toBe(true);
    expect(isDemandSideCycle(report())).toBe(false);
  });

  it("teases Sky's take when present, else the demand-side total as kept", () => {
    expect(teaserFigure(report())).toEqual({ amount: 60, suffix: "to Sky" });
    expect(teaserFigure(keel)).toEqual({ amount: 36_231, suffix: "kept" });
  });

  it("plots demand as the kept bar when Sky and P2G are both ~0", () => {
    expect(barPair(report())).toEqual({ sky: 60, prime: 40 });
    expect(barPair(keel)).toEqual({ sky: 0, prime: 36_231 });
  });

  it("lists demand-side figures instead of the three supply-side totals", () => {
    expect(headlineFigures(report(), "Spark").map((f) => f.label)).toEqual([
      "To Sky",
      "Kept by Spark",
      "Cost of funds",
    ]);
    expect(headlineFigures(keel, "Keel")).toEqual([
      { label: "Demand-side", value: 36_231 },
      { label: "Agent rate", value: 32_004 },
      { label: "Distribution rewards", value: 4_227 },
    ]);
    expect(headlineFigures(skybase, "Skybase").map((f) => f.label)).toEqual([
      "Demand-side",
      "Agent rate",
      "Distribution rewards",
      "Accessibility rewards",
    ]);
  });
});

describe("loadSettlements", () => {
  beforeEach(() => {
    resetSettlementsCache();
    fetchJson.mockReset();
  });
  afterEach(() => resetSettlementsCache());

  it("returns the fetched bundle and memoises it", async () => {
    const bundle: SettlementsBundle = { source: {}, reports: [report()] };
    fetchJson.mockResolvedValue(bundle);
    await expect(loadSettlements()).resolves.toBe(bundle);
    await expect(loadSettlements()).resolves.toBe(bundle);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(fetchJson.mock.calls[0][0]).toMatch(/settlements\.json$/);
  });

  it("returns EMPTY_SETTLEMENTS when the artifact is missing, and retries next call", async () => {
    fetchJson.mockRejectedValueOnce(new Error("settlements.json: 404"));
    await expect(loadSettlements()).resolves.toBe(EMPTY_SETTLEMENTS);
    fetchJson.mockResolvedValueOnce({ source: {}, reports: [report()] });
    await expect(loadSettlements()).resolves.toEqual({ source: {}, reports: [report()] });
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });
});
