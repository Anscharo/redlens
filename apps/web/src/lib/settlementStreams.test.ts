import { describe, it, expect } from "vitest";
import { hasStreams, PRIME_LEVEL_ID, OTHER_ID, streamModel } from "@/lib/settlementStreams";
import { supplyKept, type SettlementReport, type SettlementVenue } from "@/lib/settlements";

function venue(id: string, revenue: number, cofAlloc: number, sd = 0, spread = 0): SettlementVenue {
  return {
    id,
    label: id,
    chain: "ethereum",
    synthetic: false,
    revenueToPrime: revenue,
    cofAlloc,
    sdRevenue: sd,
    profitToSky: cofAlloc - spread + sd,
    profitToGrove: revenue - cofAlloc,
  };
}

function report(venues: SettlementVenue[], over: Partial<SettlementReport["headline"]> = {}): SettlementReport {
  const rev = venues.reduce((n, v) => n + v.revenueToPrime, 0);
  const cof = venues.reduce((n, v) => n + v.profitToSky - (v.sdRevenue ?? 0), 0);
  const sde = venues.reduce((n, v) => n + (v.sdRevenue ?? 0), 0);
  return {
    prime: "spark",
    month: "2026-09",
    settleVersion: null,
    generatedAt: null,
    period: { start: "2026-09-01", end: "2026-09-30", nDays: 30 },
    headline: { primeAgentRevenue: rev, skyRevenue: cof + sde, profitToGrove: 0, cof, sdeRevenue: sde, ...over },
    venues,
  };
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("streamModel", () => {
  it("foots to the headline: Σ kept = supplyKept, Σ cof + Σ sde = To Sky", () => {
    // Spark-shaped: a spread refund on a synthetic row, plus revenue no venue
    // row carries (PSM3) — the two things Σ profitToGrove drops.
    const spread = { ...venue("SPREAD", 0, 0, 0, 500), synthetic: true };
    const r = report([venue("A", 10_000, 4_000), venue("B", 3_000, 1_000, 2_000), spread]);
    r.headline.primeAgentRevenue += 1_500;
    const m = streamModel(r);
    expect(sum(m.venues.map((v) => v.kept))).toBeCloseTo(supplyKept(r));
    expect(sum(m.venues.map((v) => v.cof)) + sum(m.venues.map((v) => v.sde))).toBeCloseTo(r.headline.skyRevenue);
    expect(m.venues.find((v) => v.id === PRIME_LEVEL_ID)?.revenue).toBeCloseTo(1_500);
    expect(m.toSky).toBe(r.headline.skyRevenue);
    expect(m.kept).toBeCloseTo(supplyKept(r));
  });

  it("keeps a loss venue's sign and the SDE passing through", () => {
    const m = streamModel(report([venue("A", 5_000, 1_000, 800), venue("L", -2_000, 300)]));
    expect(m.venues.find((v) => v.id === "L")).toMatchObject({ revenue: -2_000, cof: 300, kept: -2_300 });
    expect(m.venues.find((v) => v.id === "A")).toMatchObject({ sde: 800, cof: 1_000 });
  });

  it("folds the tail into one Other row and drops all-zero rows", () => {
    const many = Array.from({ length: 15 }, (_, i) => venue(`V${i}`, 1_000 * (i + 1), 100));
    const m = streamModel(report([...many, venue("ZERO", 0, 0)]), 12);
    expect(m.venues).toHaveLength(13);
    expect(m.venues.at(-1)?.id).toBe(OTHER_ID);
    expect(m.venues.some((v) => v.id === "ZERO")).toBe(false);
  });

  it("never folds a venue with Sky Direct Exposure, however small", () => {
    const many = Array.from({ length: 15 }, (_, i) => venue(`V${i}`, 1_000 * (i + 1), 100));
    const m = streamModel(report([...many, venue("SDE", 0, 0, 50)]), 12);
    expect(m.venues.map((v) => v.id).slice(12)).toEqual(["SDE", OTHER_ID]);
  });

  it("draws a demand-only Prime by its demand lane", () => {
    const m = streamModel(report([], { agentRate: 30_000, distributionRewards: 5_000 }));
    expect(m.venues).toHaveLength(0);
    expect(m.demand.map((d) => d.key)).toEqual(["agentRate", "distributionRewards"]);
    expect(m.demandTotal).toBe(35_000);
    expect(m.demandMsc).toBe(35_000);
  });

  it("keeps the Stage 1 amount due from Sky apart from the other rewards Sky pays", () => {
    const m = streamModel(report([], { agentRate: 30_000, gar: 300_000, chroniclePoints: 17_000 }));
    expect(m.demandTotal).toBe(347_000);
    expect(m.demandMsc).toBe(30_000);
    expect(hasStreams(m)).toBe(true);
  });
});
