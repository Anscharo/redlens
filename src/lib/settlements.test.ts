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
  supplyKept,
  isDemandSideCycle,
  teaserFigure,
  summaryThreeWay,
  threeWayPeaks,
  barFillStyle,
  headlineFigures,
  activeDemandSeries,
  hasMultiVenuePnl,
  hasVenueAum,
  collapseAum,
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

  it("sums agent rate and rewards, and never falls back to the prime-side total", () => {
    expect(demandSideRevenue(KEEL_HEADLINE)).toBe(36_231);
    expect(demandSideRevenue(report().headline)).toBe(0);
    // primeAgentTotalRevenue is supply + demand. Returning it here when the
    // demand parts are zero double-counts the whole cycle against
    // supplyKept + skyRevenue, so it must stay 0.
    expect(
      demandSideRevenue({ ...KEEL_HEADLINE, agentRate: 0, distributionRewards: 0 }),
    ).toBe(0);
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

  it("splits the Summary into Sky / supply kept / demand-side", () => {
    // kept is prime_agent_revenue (100) − cof (40), not profitToGrove (40).
    expect(summaryThreeWay(report())).toEqual({ month: "2026-07", sky: 60, kept: 60, demand: 0 });
    expect(summaryThreeWay(keel)).toEqual({ month: "2026-07", sky: 0, kept: 0, demand: 36_231 });
    const loss = report({ headline: { ...report().headline, primeAgentRevenue: 20, cof: 40 } });
    expect(summaryThreeWay(loss).kept).toBe(-20);
  });

  it("places a signed kept bar below the zero line", () => {
    const { peakPos, peakNeg } = threeWayPeaks([
      { month: "2026-01", sky: 80, kept: -20, demand: 10 },
    ]);
    expect(peakPos).toBe(80);
    expect(peakNeg).toBe(20);
    const neg = barFillStyle(-20, peakPos, peakNeg);
    const pos = barFillStyle(80, peakPos, peakNeg);
    expect(neg).toEqual({ bottom: "0%", height: "20%" });
    expect(pos).toEqual({ bottom: "20%", height: "80%" });
  });

  it("lists the three flows, with CoF as a component of To Sky", () => {
    // CoF is not a fourth destination — it is the money already shown as
    // "To Sky" (settlement-cycle derives cof = sky_revenue − sde_revenue),
    // so it renders as a marked component and never as a peer row.
    expect(headlineFigures(report())).toEqual([
      { label: "To Sky", value: 60 },
      { label: "of which cost of funds", value: 40, component: true },
      { label: "Supply kept", value: 60 },
      { label: "Demand-side", value: 0 },
    ]);
    expect(headlineFigures(report()).filter((f) => !f.component)).toHaveLength(3);
    expect(headlineFigures(keel)).toEqual([
      { label: "To Sky", value: 0 },
      { label: "Supply kept", value: 0 },
      { label: "Demand-side", value: 36_231 },
    ]);
    expect(headlineFigures(skybase).map((f) => f.label)).toEqual([
      "To Sky",
      "Supply kept",
      "Demand-side",
    ]);
  });

  it("keeps supply kept on the prime-level basis, not the venue-row sum", () => {
    // Regression: "Supply kept" used to read headline.profitToGrove (Σ
    // per-venue Profit to Grove). That sum drops prime-level revenue with
    // no venue row and the sUSDS spread reimbursement — on Spark it ran
    // ~$1.0M/month low and disagreed with Soter's published summary.md.
    const r = report({
      headline: { ...report().headline, primeAgentRevenue: 8_602_621, cof: 5_755_899 },
      venues: [{ ...report().venues[0], profitToGrove: 2_652_602 }],
    });
    expect(supplyKept(r)).toBe(2_846_722);
    expect(supplyKept(r)).not.toBe(r.headline.profitToGrove);
  });

  it("three-way split foots to prime revenue + demand + SDE", () => {
    const r = report();
    const { sky, kept, demand } = summaryThreeWay(r);
    const h = r.headline;
    expect(sky + kept + demand).toBe(h.primeAgentRevenue + demand + h.sdeRevenue);
  });

  it("activates demand-series that appear in any month", () => {
    expect(activeDemandSeries([keel]).map((s) => s.key)).toEqual(["agentRate", "distributionRewards"]);
    expect(activeDemandSeries([skybase]).map((s) => s.key)).toEqual([
      "agentRate",
      "distributionRewards",
      "gar",
    ]);
    expect(activeDemandSeries([report()])).toEqual([]);
  });

  it("counts multi-venue PnL and AUM separately", () => {
    expect(hasMultiVenuePnl(report())).toBe(false);
    expect(hasMultiVenuePnl(keel)).toBe(false);
    expect(hasMultiVenuePnl(report({
      venues: [
        { id: "a", label: "A", chain: "", synthetic: false, revenueToPrime: 1, cofAlloc: 0, profitToSky: 10, profitToGrove: 0 },
        { id: "b", label: "B", chain: "", synthetic: false, revenueToPrime: 1, cofAlloc: 0, profitToSky: 5, profitToGrove: 0 },
      ],
    }))).toBe(true);
    expect(hasVenueAum(report({ venues: [{ ...report().venues[0]!, valueEom: 1_000 }] }))).toBe(true);
    expect(hasVenueAum(keel)).toBe(false);
  });

  it("folds AUM tails into Other", () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      id: `v${i}`,
      label: `V${i}`,
      synthetic: false,
      valueEom: 15 - i,
    }));
    const out = collapseAum(many, 4);
    expect(out).toHaveLength(5);
    expect(out[0]!.id).toBe("v0");
    expect(out[4]!.label).toMatch(/Other venues \(11\)/);
    expect(out[4]!.valueEom).toBe(many.slice(4).reduce((n, v) => n + v.valueEom, 0));
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
