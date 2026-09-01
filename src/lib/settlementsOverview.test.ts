import { describe, it, expect } from "vitest";
import { supplyKept, type SettlementReport, type SettlementsBundle } from "./settlements";
import {
  actorForPrimeKey,
  ecosystemHeadlineFigures,
  ecosystemMonths,
  ecosystemThreeWay,
  latestSettlementMonth,
  primeFlowsForMonth,
  settlementMonths,
} from "./settlementsOverview";

function report(
  over: Omit<Partial<SettlementReport>, "headline"> & {
    headline?: Partial<SettlementReport["headline"]>;
  } = {},
): SettlementReport {
  return {
    prime: "spark",
    month: "2026-07",
    settleVersion: null,
    generatedAt: null,
    period: null,
    venues: [],
    ...over,
    headline: {
      primeAgentRevenue: 100,
      skyRevenue: 60,
      profitToGrove: 40,
      cof: 40,
      sdeRevenue: 20,
      agentRate: 5,
      distributionRewards: 3,
      chroniclePoints: 0,
      gar: 0,
      ...over.headline,
    },
  };
}

// Spark-shaped: non-venue revenue makes Σ venue profitToGrove differ from
// par − cof — the fixture that catches the wrong supply-side basis.
const spark = report({
  headline: { primeAgentRevenue: 1_000_000, skyRevenue: 620_000, cof: 600_000, sdeRevenue: 20_000, profitToGrove: 350_000, agentRate: 90_000, distributionRewards: 10_000 },
  venues: [
    { id: "S1", label: "V", chain: "ethereum", synthetic: false, revenueToPrime: 900_000, cofAlloc: 550_000, profitToSky: 550_000, profitToGrove: 350_000 },
  ],
});
const osero = report({
  prime: "osero",
  headline: { primeAgentRevenue: 400, skyRevenue: 497, cof: 497, sdeRevenue: 0, profitToGrove: -97, agentRate: 12_000, distributionRewards: 0 },
});
const keel = report({
  prime: "keel",
  headline: { primeAgentRevenue: 0, skyRevenue: 0, cof: 0, sdeRevenue: 0, profitToGrove: 0, agentRate: 280_000, distributionRewards: 0 },
});
const sparkJun = report({
  month: "2026-06",
  headline: { primeAgentRevenue: 800_000, skyRevenue: 500_000, cof: 490_000, sdeRevenue: 10_000, profitToGrove: 0 },
});
const bundle: SettlementsBundle = {
  source: { repo: "soterlabs/settlement-reports" },
  reports: [sparkJun, spark, osero, keel],
};

describe("settlementMonths", () => {
  it("returns sorted unique months across the ragged matrix", () => {
    expect(settlementMonths(bundle)).toEqual(["2026-06", "2026-07"]);
    expect(latestSettlementMonth(bundle)).toBe("2026-07");
    expect(latestSettlementMonth({ source: {}, reports: [] })).toBeNull();
  });
});

describe("primeFlowsForMonth", () => {
  it("filters by month, sorts by magnitude desc, keeps per-prime latestMonth", () => {
    const flows = primeFlowsForMonth(bundle, "2026-07");
    expect(flows.map((f) => f.prime)).toEqual(["spark", "keel", "osero"]);
    expect(flows.every((f) => f.latestMonth === "2026-07")).toBe(true);
    const jun = primeFlowsForMonth(bundle, "2026-06");
    expect(jun).toHaveLength(1);
    // spark's own latest is July even when viewing June — the ?msc-omit rule.
    expect(jun[0].latestMonth).toBe("2026-07");
  });

  it("derives kept via supplyKept and drops near-zero demand parts", () => {
    const [f] = primeFlowsForMonth(bundle, "2026-07");
    expect(f.kept).toBe(supplyKept(spark));
    expect(f.kept).toBe(400_000);
    expect(f.demandParts).toEqual({ agentRate: 90_000, distributionRewards: 10_000 });
  });

  it("keeps demand-only and negative-kept primes", () => {
    const flows = primeFlowsForMonth(bundle, "2026-07");
    const k = flows.find((f) => f.prime === "keel")!;
    expect(k.sky).toBe(0);
    expect(k.demand).toBe(280_000);
    const o = flows.find((f) => f.prime === "osero")!;
    expect(o.kept).toBe(-97);
  });
});

describe("ecosystemThreeWay", () => {
  it("sums supply kept per prime, never Σ venue profitToGrove", () => {
    const eco = ecosystemThreeWay(bundle, "2026-07");
    const reports = [spark, osero, keel];
    expect(eco.kept).toBeCloseTo(reports.reduce((n, r) => n + supplyKept(r), 0), 6);
    const venueSum = reports.reduce((n, r) => n + r.venues.reduce((m, v) => m + v.profitToGrove, 0), 0);
    expect(eco.kept).not.toBe(venueSum);
  });

  it("keeps cof + sde = sky and foots to ~0", () => {
    const eco = ecosystemThreeWay(bundle, "2026-07");
    expect(eco.cof + eco.sde).toBeCloseTo(eco.sky, 6);
    expect(eco.footDelta).toBeCloseTo(0, 6);
  });

  it("trips footDelta when a headline is corrupted", () => {
    const bad: SettlementsBundle = {
      source: {},
      reports: [report({ headline: { skyRevenue: 999_999 } })],
    };
    expect(Math.abs(ecosystemThreeWay(bad, "2026-07").footDelta)).toBeGreaterThan(1);
  });
});

describe("ecosystemMonths / ecosystemHeadlineFigures", () => {
  it("emits one three-way per month", () => {
    const months = ecosystemMonths(bundle);
    expect(months.map((m) => m.month)).toEqual(["2026-06", "2026-07"]);
    expect(months[1].sky).toBeCloseTo(620_497, 6);
  });

  it("renders CoF and SDE as components, omitting near-zero ones", () => {
    const rows = ecosystemHeadlineFigures(ecosystemThreeWay(bundle, "2026-07"));
    expect(rows[0]).toEqual({ label: "To Sky", value: expect.any(Number) });
    expect(rows.find((r) => r.label === "of which cost of funds")?.component).toBe(true);
    expect(rows.find((r) => r.label === "of which Sky Direct Exposure")?.component).toBe(true);
    expect(rows.map((r) => r.label)).toContain("Supply kept");
    expect(rows.map((r) => r.label)).toContain("Demand-side");

    const noSde = ecosystemHeadlineFigures(ecosystemThreeWay({ source: {}, reports: [osero] }, "2026-07"));
    expect(noSde.some((r) => r.label === "of which Sky Direct Exposure")).toBe(false);
  });
});

describe("actorForPrimeKey", () => {
  const actors = [
    { slug: "spark-party", name: "Spark (party)" },
    { slug: "spark", name: "Spark" },
    { slug: "grove-party", name: "Grove" },
  ];
  it("prefers an exact slug match over -party", () => {
    expect(actorForPrimeKey("spark", actors)?.slug).toBe("spark");
  });
  it("matches composite -party pages", () => {
    expect(actorForPrimeKey("grove", actors)?.slug).toBe("grove-party");
  });
  it("returns null for primes with no actor", () => {
    expect(actorForPrimeKey("obex", actors)).toBeNull();
    expect(actorForPrimeKey("", actors)).toBeNull();
  });
});
