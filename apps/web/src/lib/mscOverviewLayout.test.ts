import { describe, it, expect } from "vitest";
import { layoutMscRing, WIDTH } from "./mscOverviewLayout";
import type { PrimeFlowTotals } from "@/lib/settlementsOverview";

function flow(over: Partial<PrimeFlowTotals> = {}): PrimeFlowTotals {
  return {
    prime: "spark",
    month: "2026-07",
    sky: 10_000_000,
    kept: 2_000_000,
    demand: 1_500_000,
    cof: 9_900_000,
    sde: 100_000,
    demandParts: { agentRate: 1_400_000, distributionRewards: 100_000 },
    latestMonth: "2026-07",
    ...over,
  };
}

// Real months, in PRIME_ORDER as the caller passes them.
const JULY = [
  flow({ prime: "spark", sky: 5_750_694, cof: 5_755_899, sde: -5_205, kept: 2_846_722, demand: 1_074_583, demandParts: { agentRate: 131_000, distributionRewards: 943_583 } }),
  flow({ prime: "grove", sky: 8_003_550, cof: 3_300_000, sde: 4_703_550, kept: 1_563_759, demand: 114_024, demandParts: { agentRate: 72_000, distributionRewards: 29_000, chroniclePoints: 13_024 } }),
  flow({ prime: "keel", sky: 0, cof: 0, sde: 0, kept: 0, demand: 36_000, demandParts: { agentRate: 32_000, distributionRewards: 4_000 } }),
  flow({ prime: "skybase", sky: 0, cof: 0, sde: 0, kept: 0, demand: 238_107, demandParts: { agentRate: 38_000, distributionRewards: 95_000, gar: 105_107 } }),
  flow({ prime: "obex", sky: 1_761_245, cof: 1_761_245, sde: 0, kept: 764_735, demand: 71_997, demandParts: { agentRate: 71_997 } }),
  flow({ prime: "osero", sky: 497, cof: 497, sde: 0, kept: -107, demand: 12_149, demandParts: { agentRate: 12_094, distributionRewards: 55 } }),
];
const APRIL = [
  flow({ prime: "spark", sky: 9_300_000, cof: 9_290_000, sde: 13_000, kept: 1_270_000, demand: 1_620_000, demandParts: { agentRate: 115_000, distributionRewards: 1_500_000 } }),
  flow({ prime: "grove", sky: 9_340_000, cof: 2_950_000, sde: 6_400_000, kept: 3_590_000, demand: 187_000, demandParts: { agentRate: 45_000, distributionRewards: 125_000, chroniclePoints: 17_000 } }),
  flow({ prime: "keel", sky: 0, cof: 0, sde: 0, kept: 0, demand: 55_000, demandParts: { agentRate: 32_000, distributionRewards: 23_000 } }),
  flow({ prime: "skybase", sky: 0, cof: 0, sde: 0, kept: 0, demand: 368_000, demandParts: { agentRate: 32_000, distributionRewards: 211_000, gar: 125_000 } }),
  flow({ prime: "obex", sky: 1_970_000, cof: 1_970_000, sde: 0, kept: 262_000, demand: 68_000, demandParts: { agentRate: 68_000 } }),
];
// Grove, Mar 2026: a $2.07M supply LOSS.
const MARCH_GROVE = flow({ prime: "grove", sky: 6_370_000, cof: 3_120_000, sde: 3_250_000, kept: -2_070_000, demand: 198_000, demandParts: { agentRate: 6_000, distributionRewards: 192_000 } });

const sliceArea = (p: { r: number; hole: { r: number } | null }) => Math.PI * (p.r ** 2 - (p.hole?.r ?? 0) ** 2);

describe("layoutMscRing (orbital pies)", () => {
  it("returns an empty layout for no primes or all-zero flows", () => {
    expect(layoutMscRing([]).primes).toEqual([]);
    expect(layoutMscRing([flow({ sky: 0, cof: 0, sde: 0, kept: 0, demand: 0, demandParts: {} })]).primes).toEqual([]);
  });

  it("slices each pie by the workbook's line items, To-Sky pair first, demand-side series last", () => {
    const layout = layoutMscRing(APRIL);
    const grove = layout.primes.find((p) => p.prime === "grove")!;
    expect(grove.slices.map((s) => s.kind)).toEqual(["cof", "sde", "kept", "agentRate", "distributionRewards", "chroniclePoints"]);
    expect(grove.slices.map((s) => s.signed)).toEqual([2_950_000, 6_400_000, 3_590_000, 45_000, 125_000, 17_000]);
    expect(grove.hole).toBeNull();
    // No wedge for a series the prime doesn't have (Grove has no GAR).
    expect(grove.slices.some((s) => s.kind === "gar")).toBe(false);
    for (const s of grove.slices) {
      expect(s.path).toMatch(/^M/);
      expect(s.path).not.toMatch(/NaN/);
    }
  });

  it("turns a loss into a hole whose area is the loss, so the ring's area is gross revenue", () => {
    const layout = layoutMscRing([MARCH_GROVE, flow({ prime: "spark" })]);
    const grove = layout.primes.find((p) => p.prime === "grove")!;
    const spark = layout.primes.find((p) => p.prime === "spark")!;
    expect(grove.hole).not.toBeNull();
    expect(grove.hole!.signed).toBe(-2_070_000);
    expect(grove.hole!.kinds).toEqual(["kept"]);
    // Slices exclude the loss.
    expect(grove.slices.map((s) => s.kind)).toEqual(["cof", "sde", "agentRate", "distributionRewards"]);
    // One area scale: ring area ∝ gross revenue on both pies.
    expect(grove.gross).toBeCloseTo(6_370_000 - 2_070_000 + 198_000, 0);
    expect(sliceArea(grove) / sliceArea(spark)).toBeCloseTo(grove.gross / spark.gross, 2);
    // The hole never breaches the rim.
    expect(grove.hole!.r).toBeLessThan(grove.r - 5);
  });

  it("faces the To-Sky slices toward Sky so the arrow leaves from them", () => {
    const layout = layoutMscRing(APRIL);
    for (const p of layout.primes) {
      const toSky = p.slices.filter((s) => s.kind === "cof" || s.kind === "sde");
      if (toSky.length === 0) continue;
      // The To-Sky pair is one contiguous run whose angular center points at Sky.
      const center = (toSky[0].a0 + toSky[toSky.length - 1].a1) / 2;
      const towardSky = Math.atan2(layout.cy - p.cy, layout.cx - p.cx);
      const diff = Math.abs(((center - towardSky + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
      expect(diff).toBeLessThan(1e-6);
    }
  });

  it("puts the donut and the pies on one area scale: $20.6M To Sky outranks a $13.1M Prime", () => {
    const layout = layoutMscRing(APRIL);
    const grove = layout.primes.find((p) => p.prime === "grove")!; // positives 13.1M
    const spark = layout.primes.find((p) => p.prime === "spark")!; // 12.19M
    const keel = layout.primes.find((p) => p.prime === "keel")!; // 55k → floor
    expect(layout.skyR).toBe(160);
    expect(grove.r / layout.skyR).toBeCloseTo(Math.sqrt(13_127_000 / 20_610_000), 2);
    expect(spark.r / layout.skyR).toBeCloseTo(Math.sqrt(12_218_000 / 20_610_000), 2);
    expect(layout.skyInnerR).toBeLessThan(layout.skyR);
    expect(keel.r).toBeGreaterThanOrEqual(22);
    expect(keel.r).toBeLessThan(spark.r);
  });

  it("lets a Prime outrank the donut when it earns more than Sky takes", () => {
    const layout = layoutMscRing([flow({ sky: 1_000_000, cof: 1_000_000, sde: 0, kept: 8_000_000, demand: 1_000_000, demandParts: { agentRate: 1_000_000 } })]);
    expect(layout.primes[0].r).toBe(160);
    expect(layout.skyR).toBeLessThan(160);
    expect(layout.skyR).toBeGreaterThanOrEqual(80);
  });

  it("gives each arrow the share of the prime's gross revenue that went to Sky", () => {
    const layout = layoutMscRing(JULY);
    const grove = layout.primes.find((p) => p.prime === "grove")!;
    expect(grove.arrow!.share).toBeCloseTo(8_003_550 / (8_003_550 + 1_563_759 + 114_024), 6);
    expect(grove.arrow!.cof).toBe(3_300_000);
    expect(grove.arrow!.sde).toBe(4_703_550);
    const skybase = layout.primes.find((p) => p.prime === "skybase")!;
    expect(skybase.arrow).toBeNull();
    expect(layout.skyWedges.map((w) => w.prime)).not.toContain("skybase");
  });

  it("reports a share over 100% when a prime owed Sky more than it made (Grove, Mar 2026)", () => {
    const layout = layoutMscRing([MARCH_GROVE]);
    expect(layout.primes[0].arrow!.share).toBeGreaterThan(1);
  });

  it("subdivides the Sky donut into one wedge per contributing prime, together making the whole ring", () => {
    const layout = layoutMscRing([
      flow({ prime: "grove", sky: 8_000_000, cof: 8_000_000, sde: 0, kept: 1_500_000, demand: 100_000 }),
      flow({ prime: "spark", sky: 6_000_000, cof: 6_000_000, sde: 0, kept: 2_800_000, demand: 1_000_000 }),
      flow({ prime: "keel", sky: 0, cof: 0, sde: 0, kept: 0, demand: 280_000, demandParts: { agentRate: 280_000 } }),
    ]);
    expect(layout.skyWedges.map((w) => w.prime)).toEqual(["grove", "spark"]);
    const [grove, spark] = layout.skyWedges;
    expect(grove.value / (grove.value + spark.value)).toBeCloseTo(8 / 14, 2);
    const groveRing = layout.primes.find((p) => p.prime === "grove")!;
    expect(groveRing.arrow!.dock).toBeGreaterThanOrEqual(grove.a0);
    expect(groveRing.arrow!.dock).toBeLessThanOrEqual(grove.a1);
  });

  it("docks every arrow at the nearest point of its own wedge, so none has to cross the donut", () => {
    for (const month of [JULY, APRIL]) {
      const layout = layoutMscRing(month);
      for (const p of layout.primes) {
        if (!p.arrow) continue;
        const wedge = layout.skyWedges.find((w) => w.prime === p.prime)!;
        expect(p.arrow.dock).toBeGreaterThanOrEqual(wedge.a0);
        expect(p.arrow.dock).toBeLessThanOrEqual(wedge.a1);
        const toward = Math.atan2(p.cy - layout.cy, p.cx - layout.cx);
        const diff = Math.abs(((toward - p.arrow.dock + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
        expect(diff).toBeLessThan(Math.PI / 2);
        expect(Math.hypot(p.arrow.amountX - layout.cx, p.arrow.amountY - layout.cy)).toBeGreaterThan(layout.skyR);
      }
    }
  });

  it("keeps the primes in the order given, evenly spaced clockwise from 12 o'clock", () => {
    const layout = layoutMscRing(JULY);
    expect(layout.primes.map((p) => p.prime)).toEqual(["spark", "grove", "keel", "skybase", "obex", "osero"]);
    expect(layout.skyWedges.map((w) => w.prime)).toEqual(["spark", "grove", "obex", "osero"]);
    const turns = layout.primes.map((p) => ((p.angle + Math.PI / 2) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI));
    for (let i = 1; i < turns.length; i++) expect(turns[i]).toBeGreaterThan(turns[i - 1]);
    expect(turns[0]).toBeLessThan(0.05);
    for (let i = 1; i < turns.length; i++) expect(turns[i] - turns[i - 1]).toBeGreaterThan(Math.PI / 6);
  });

  it("parks each hover pill off the mark it names, with the leader still on the mark", () => {
    const layout = layoutMscRing([MARCH_GROVE, ...JULY.filter((f) => f.prime !== "grove")]);
    for (const p of layout.primes) {
      for (const s of p.slices) {
        // Anchor inside the ring (between hole and rim), pill outside the pie.
        const d = Math.hypot(s.amountX - p.cx, s.amountY - p.cy);
        expect(d).toBeLessThanOrEqual(p.r);
        expect(d).toBeGreaterThanOrEqual(p.hole?.r ?? 0);
        expect(Math.hypot(s.pillX - p.cx, s.pillY - p.cy)).toBeGreaterThan(p.r);
      }
      if (p.hole) expect(Math.hypot(p.hole.pillX - p.cx, p.hole.pillY - p.cy)).toBeGreaterThan(p.r);
      if (p.arrow) {
        expect(Math.hypot(p.arrow.pillX - p.arrow.amountX, p.arrow.pillY - p.arrow.amountY)).toBeGreaterThan(20);
      }
      // Name outside the pie, gross pill on the far side of the name.
      expect(Math.abs(p.labelY - p.cy)).toBeGreaterThan(p.r);
      expect(Math.sign(p.grossPillY - p.labelY)).toBe(Math.sign(p.labelY - p.cy));
    }
  });

  it("keeps every pie inside the fixed frame, clear of the donut and of each other", () => {
    for (const month of [JULY, APRIL, [MARCH_GROVE, flow()]]) {
      const layout = layoutMscRing(month);
      for (let i = 0; i < layout.primes.length; i++) {
        const a = layout.primes[i];
        expect(a.cx - a.r).toBeGreaterThan(0);
        expect(a.cx + a.r).toBeLessThan(WIDTH);
        expect(a.cy - a.r - 24).toBeGreaterThan(0);
        expect(a.cy + a.r + 24).toBeLessThan(layout.height);
        expect(Math.hypot(a.cx - layout.cx, a.cy - layout.cy)).toBeGreaterThan(layout.skyR + a.r);
        for (let j = i + 1; j < layout.primes.length; j++) {
          const b = layout.primes[j];
          expect(Math.hypot(a.cx - b.cx, a.cy - b.cy)).toBeGreaterThanOrEqual(a.r + b.r - 1e-6);
        }
      }
    }
  });

  it("keeps a demand-only prime as a pie with no arrow (Keel/Skybase)", () => {
    const layout = layoutMscRing([flow({ prime: "keel", sky: 0, cof: 0, sde: 0, kept: 0, demand: 280_000, demandParts: { agentRate: 250_000, distributionRewards: 30_000 } })]);
    expect(layout.primes).toHaveLength(1);
    expect(layout.primes[0].arrow).toBeNull();
    expect(layout.primes[0].slices.map((s) => s.kind)).toEqual(["agentRate", "distributionRewards"]);
  });

  it("is deterministic for the same input", () => {
    const primes = [flow(), flow({ prime: "grove" })];
    expect(layoutMscRing(primes)).toEqual(layoutMscRing(primes));
  });
});
