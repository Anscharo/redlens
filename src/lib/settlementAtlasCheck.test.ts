import { describe, expect, it } from "vitest";
import { atlasAmountDue, atlasAmountDueTotal } from "./settlementAtlasCheck";
import type { SettlementReport, SettlementVenue } from "./settlements";

function venue(label: string, revenue: number, cof: number, sde = 0, synthetic = false): SettlementVenue {
  return { id: label, label, chain: "ethereum", synthetic, revenueToPrime: revenue, cofAlloc: cof, sdRevenue: sde, profitToSky: cof + sde, profitToGrove: revenue - cof };
}

function report(prime: string, venues: SettlementVenue[]): SettlementReport {
  const sky = venues.reduce((n, v) => n + v.profitToSky, 0);
  return {
    prime,
    month: "2026-09",
    settleVersion: null,
    generatedAt: null,
    period: { start: "2026-09-01", end: "2026-09-30", nDays: 30 },
    headline: { primeAgentRevenue: 0, skyRevenue: sky, profitToGrove: 0, cof: sky, sdeRevenue: 0 },
    venues,
  };
}

describe("atlasAmountDue", () => {
  it("matches Soter when no venue earns less than its cost of funds", () => {
    expect(atlasAmountDue(report("grove", [venue("A", 100, 60), venue("J", 0, 0, 40)]))).toEqual({ soter: 100, atlas: 100, gap: 0 });
  });

  it("floors a losing venue: Sky gets its revenue, not its full cost", () => {
    const due = atlasAmountDue(report("grove", [venue("A", 100, 60), venue("L", 10, 50)]));
    expect(due).toEqual({ soter: 110, atlas: 70, gap: 40 });
  });

  it("takes no floor on Spark's USDT and pyUSD in SparkLend, or on synthetic rows", () => {
    const due = atlasAmountDue(report("spark", [
      venue("Spark USDT (SparkLend spToken)", 10, 50),
      venue("Spark PYUSD (SparkLend spToken)", 10, 30),
      venue("Spread refund", 0, -5, 0, true),
      venue("Spark.fi PYUSD Reserve Uniswap V4", 0, 20),
    ]));
    expect(due.atlas).toBe(50 + 30 - 5 + 0);
    expect(due.gap).toBe(20);
  });

  it("sums a month's Primes, or a Prime's months", () => {
    const total = atlasAmountDueTotal([report("grove", [venue("A", 100, 60), venue("L", 10, 50)]), report("obex", [venue("B", 5, 20)])]);
    expect(total).toEqual({ soter: 130, atlas: 75, gap: 55 });
  });
});
