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
    demandParts: {},
    latestMonth: "2026-07",
    ...over,
  };
}

const JULY = [
  flow({ prime: "grove", sky: 8_003_550, kept: 1_563_759, demand: 114_024 }),
  flow({ prime: "spark", sky: 5_750_694, kept: 2_846_722, demand: 1_074_583 }),
  flow({ prime: "obex", sky: 1_761_245, kept: 764_735, demand: 71_997 }),
  flow({ prime: "skybase", sky: 0, kept: 0, demand: 238_107 }),
  flow({ prime: "osero", sky: 497, kept: -107, demand: 12_149 }),
];

describe("layoutMscRing (orbital bars)", () => {
  it("returns an empty layout for no primes or all-zero flows", () => {
    expect(layoutMscRing([]).primes).toEqual([]);
    expect(layoutMscRing([flow({ sky: 0, kept: 0, demand: 0 })]).primes).toEqual([]);
  });

  it("stacks gains above the zero line and losses below it, on one linear scale", () => {
    const layout = layoutMscRing([
      flow(), // kept 2M + demand 1.5M
      flow({ prime: "grove", sky: 6_000_000, kept: -1_000_000, demand: 500_000 }),
    ]);
    const spark = layout.primes.find((p) => p.prime === "spark")!;
    const grove = layout.primes.find((p) => p.prime === "grove")!;
    const sKept = spark.segments.find((s) => s.kind === "kept")!;
    const sDemand = spark.segments.find((s) => s.kind === "demand")!;
    const gKept = grove.segments.find((s) => s.kind === "kept")!;
    const gDemand = grove.segments.find((s) => s.kind === "demand")!;
    // Gains end at the zero line and grow upward.
    expect(sKept.y + sKept.h).toBeCloseTo(spark.zeroY, 6);
    expect(sDemand.y + sDemand.h).toBeCloseTo(sKept.y, 6);
    // A loss starts at the zero line and hangs below it.
    expect(gKept.y).toBeCloseTo(grove.zeroY, 6);
    expect(gDemand.y + gDemand.h).toBeCloseTo(grove.zeroY, 6);
    // Linear: 2M kept is exactly 4× the 500k demand, on every bar.
    expect(sKept.h / gDemand.h).toBeCloseTo(4, 6);
    expect(gKept.h / gDemand.h).toBeCloseTo(2, 6);
  });

  it("badges each arrow with the share of what the prime produced that went to Sky", () => {
    const layout = layoutMscRing(JULY);
    const grove = layout.primes.find((p) => p.prime === "grove")!;
    // 8.00M ÷ (8.00M + 1.56M + 0.11M)
    expect(grove.arrow!.share).toBeCloseTo(8_003_550 / (8_003_550 + 1_563_759 + 114_024), 6);
    // A prime that pays Sky nothing has no arrow and no wedge.
    const skybase = layout.primes.find((p) => p.prime === "skybase")!;
    expect(skybase.arrow).toBeNull();
    expect(layout.skyWedges.map((w) => w.prime)).not.toContain("skybase");
  });

  it("reports a share over 100% when a prime owed Sky more than it made (Grove, Mar 2026)", () => {
    const layout = layoutMscRing([flow({ prime: "grove", sky: 6_370_000, kept: -2_070_000, demand: 198_000 })]);
    expect(layout.primes[0].arrow!.share).toBeGreaterThan(1);
  });

  it("subdivides the Sky donut into one wedge per contributing prime, together making the whole ring", () => {
    const layout = layoutMscRing([
      flow({ prime: "grove", sky: 8_000_000, kept: 1_500_000, demand: 100_000 }),
      flow({ prime: "spark", sky: 6_000_000, kept: 2_800_000, demand: 1_000_000 }),
      flow({ prime: "keel", sky: 0, kept: 0, demand: 280_000 }), // pays Sky nothing
    ]);
    expect(layout.skyWedges.map((w) => w.prime)).toEqual(["grove", "spark"]);
    const [grove, spark] = layout.skyWedges;
    expect(grove.value / (grove.value + spark.value)).toBeCloseTo(8 / 14, 2);
    // The biggest contributor's wedge is centered on its own prime's angle,
    // so its arrow runs straight in.
    const groveRing = layout.primes.find((p) => p.prime === "grove")!;
    expect(Math.abs(grove.mid - groveRing.angle)).toBeLessThan(1e-6);
    expect(layout.skyInnerR).toBeLessThan(layout.skyR);
  });

  it("parks each hover pill off the mark it names, with the leader still on the mark", () => {
    const layout = layoutMscRing(JULY);
    for (const p of layout.primes) {
      for (const s of p.segments) {
        // Leader anchor inside the segment, pill beside the bar.
        expect(s.amountX).toBeCloseTo(p.cx, 6);
        expect(s.amountY).toBeGreaterThanOrEqual(s.y);
        expect(s.amountY).toBeLessThanOrEqual(s.y + s.h);
        expect(Math.abs(s.pillX - p.cx)).toBeGreaterThan(p.barW);
      }
      if (p.arrow) {
        expect(Math.hypot(p.arrow.pillX - p.arrow.amountX, p.arrow.pillY - p.arrow.amountY)).toBeGreaterThan(20);
      }
    }
  });

  it("keeps a $6k segment beside a $2.8M one drawable", () => {
    const layout = layoutMscRing([flow({ prime: "grove", sky: 6_000_000, kept: 2_880_000, demand: 6_000 })]);
    const demand = layout.primes[0].segments.find((s) => s.kind === "demand")!;
    expect(demand.h).toBeGreaterThanOrEqual(2);
  });

  it("keeps every bar, label and arrow inside the fixed frame, with no two bars overlapping", () => {
    for (const month of [JULY, [flow(), flow({ prime: "grove", sky: 9_000_000, kept: -2_000_000 })]]) {
      const layout = layoutMscRing(month);
      for (let i = 0; i < layout.primes.length; i++) {
        const a = layout.primes[i];
        const top = Math.min(...a.segments.map((s) => s.y), a.zeroY);
        expect(top).toBeGreaterThan(0);
        expect(a.labelY + 6).toBeLessThan(layout.height);
        expect(a.cx - a.barW / 2).toBeGreaterThan(0);
        expect(a.cx + a.barW / 2).toBeLessThan(WIDTH);
        for (let j = i + 1; j < layout.primes.length; j++) {
          const b = layout.primes[j];
          const apart =
            Math.abs(a.cx - b.cx) > a.barW + 40 ||
            a.labelY + 6 < Math.min(...b.segments.map((s) => s.y), b.zeroY) ||
            b.labelY + 6 < Math.min(...a.segments.map((s) => s.y), a.zeroY);
          expect(apart).toBe(true);
        }
        // The bar body clears the donut.
        const dSky = Math.hypot(a.cx - layout.cx, a.zeroY - layout.cy);
        expect(dSky).toBeGreaterThan(layout.skyR + a.barW);
      }
    }
  });

  it("keeps To Sky out of the bar: it is a pass-through, not revenue", () => {
    const layout = layoutMscRing([flow()]);
    expect(layout.primes[0].segments.map((s) => s.kind)).toEqual(["kept", "demand"]);
    expect(layout.primes[0].arrow!.kind).toBe("sky");
  });

  it("keeps a demand-only prime as a bar with no arrow (Keel/Skybase)", () => {
    const layout = layoutMscRing([flow({ prime: "keel", sky: 0, kept: 0, demand: 280_000 })]);
    expect(layout.primes).toHaveLength(1);
    expect(layout.primes[0].arrow).toBeNull();
    expect(layout.primes[0].segments.map((s) => s.kind)).toEqual(["demand"]);
  });

  it("emits valid paths and finite anchors", () => {
    const layout = layoutMscRing(JULY);
    for (const w of layout.skyWedges) expect(w.path).toMatch(/^M[^N]*$/);
    for (const p of layout.primes) {
      if (p.arrow) {
        expect(p.arrow.path).not.toMatch(/NaN/);
        expect(p.arrow.path).toMatch(/^M/);
        expect(Number.isFinite(p.arrow.labelX)).toBe(true);
      }
      expect(Number.isFinite(p.labelX)).toBe(true);
      expect(Number.isFinite(p.labelY)).toBe(true);
    }
  });

  it("is deterministic for the same input", () => {
    const primes = [flow(), flow({ prime: "grove" })];
    expect(layoutMscRing(primes)).toEqual(layoutMscRing(primes));
  });
});
