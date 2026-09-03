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

// Spark's tallest bar: a 100px gain side AND a loss side on the top plate.
const JANUARY = [
  flow({ prime: "spark", sky: 7_840_000, kept: -339_000, demand: 1_250_000 }),
  flow({ prime: "grove", sky: 6_270_000, kept: -48_000, demand: 6_000 }),
  flow({ prime: "obex", sky: 2_110_000, kept: 439_000, demand: 74_000 }),
  flow({ prime: "keel", sky: 0, kept: 0, demand: 29_000 }),
  flow({ prime: "skybase", sky: 0, kept: 0, demand: 314_000 }),
];

const APRIL = [
  flow({ prime: "grove", sky: 9_340_000, kept: 3_590_000, demand: 187_000 }),
  flow({ prime: "spark", sky: 9_300_000, kept: 1_270_000, demand: 1_620_000 }),
  flow({ prime: "obex", sky: 1_970_000, kept: 262_000, demand: 68_000 }),
  flow({ prime: "keel", sky: 0, kept: 0, demand: 55_000 }),
  flow({ prime: "skybase", sky: 0, kept: 0, demand: 368_000 }),
];

describe("layoutMscRing (orbital bars)", () => {
  it("returns an empty layout for no primes or all-zero flows", () => {
    expect(layoutMscRing([]).primes).toEqual([]);
    expect(layoutMscRing([flow({ sky: 0, kept: 0, demand: 0 })]).primes).toEqual([]);
  });

  it("stacks gains above the zero line and losses below it, on one square-root scale", () => {
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
    // Sqrt between bars: Grove's 500k gain side is √(0.5/3.5) of Spark's 3.5M.
    expect(gDemand.h / (sKept.h + sDemand.h)).toBeCloseTo(Math.sqrt(0.5 / 3.5), 3);
    // Linear within a bar: 2M kept is 4/3 of 1.5M demand.
    expect(sKept.h / sDemand.h).toBeCloseTo(4 / 3, 6);
  });

  it("gives each arrow the share of the prime's gross revenue that went to Sky", () => {
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
    // Each contributor sits at its own wedge's angle (unless pushed to
    // clear a neighbour), so its arrow runs straight in.
    const groveRing = layout.primes.find((p) => p.prime === "grove")!;
    expect(Math.abs(Math.cos(grove.mid) - Math.cos(groveRing.angle))).toBeLessThan(0.3);
    expect(Math.abs(Math.sin(grove.mid) - Math.sin(groveRing.angle))).toBeLessThan(0.3);
    expect(layout.skyInnerR).toBeLessThan(layout.skyR);
  });

  it("parks each hover pill off the mark it names, with the leader still on the mark", () => {
    const layout = layoutMscRing(JULY);
    for (const p of layout.primes) {
      for (const s of p.segments) {
        // Leader anchor inside the segment, pill outside the plate.
        expect(s.amountX).toBeCloseTo(p.cx, 6);
        expect(s.amountY).toBeGreaterThanOrEqual(s.y);
        expect(s.amountY).toBeLessThanOrEqual(s.y + s.h);
        expect(Math.abs(s.pillX - p.plateX)).toBeGreaterThan(p.plateR);
      }
      if (p.arrow) {
        expect(Math.hypot(p.arrow.pillX - p.arrow.amountX, p.arrow.pillY - p.arrow.amountY)).toBeGreaterThan(20);
      }
    }
  });

  it("keeps a $6k segment beside a $2.8M one drawable, and a $55k prime visible beside a $3.8M one", () => {
    const layout = layoutMscRing([
      flow({ prime: "grove", sky: 6_000_000, kept: 3_590_000, demand: 187_000 }),
      flow({ prime: "keel", sky: 0, kept: 0, demand: 55_000 }),
    ]);
    const grove = layout.primes.find((p) => p.prime === "grove")!;
    const keel = layout.primes.find((p) => p.prime === "keel")!;
    expect(grove.segments.find((s) => s.kind === "demand")!.h).toBeGreaterThanOrEqual(2);
    // Linear would give Keel 1.5px; sqrt gives it ~12.
    expect(keel.segments[0].h).toBeGreaterThan(10);
  });

  it("puts every prime at its own wedge, so no arrow has to cross the donut", () => {
    for (const month of [JULY, APRIL]) {
      const layout = layoutMscRing(month);
      for (const p of layout.primes) {
        if (!p.arrow) continue;
        const wedge = layout.skyWedges.find((w) => w.prime === p.prime)!;
        const toward = Math.atan2(p.plateY - layout.cy, p.plateX - layout.cx);
        const diff = Math.abs(((toward - wedge.mid + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
        expect(diff).toBeLessThan(Math.PI / 2);
        // The arrow's hover anchor sits outside the donut.
        expect(Math.hypot(p.arrow.amountX - layout.cx, p.arrow.amountY - layout.cy)).toBeGreaterThan(layout.skyR);
      }
    }
  });

  it("puts the donut and the plates on one area scale: $20.6M To Sky outranks a $13.1M Prime", () => {
    const layout = layoutMscRing(APRIL);
    const grove = layout.primes.find((p) => p.prime === "grove")!; // gross 13.1M
    const spark = layout.primes.find((p) => p.prime === "spark")!; // gross 12.19M
    const keel = layout.primes.find((p) => p.prime === "keel")!; // 55k, content floor
    expect(grove.gross).toBeCloseTo(9_340_000 + 3_590_000 + 187_000, 0);
    // The To-Sky total (20.61M) is the month's biggest amount, so it takes
    // the max radius and every plate is scaled against it.
    expect(layout.skyR).toBe(200);
    expect(grove.plateR / layout.skyR).toBeCloseTo(Math.sqrt(13_117_000 / 20_610_000), 2);
    expect(spark.plateR / layout.skyR).toBeCloseTo(Math.sqrt(12_190_000 / 20_610_000), 2);
    expect(layout.skyInnerR).toBeLessThan(layout.skyR);
    expect(keel.plateR).toBeGreaterThanOrEqual(40);
    expect(keel.plateR).toBeLessThan(spark.plateR);
    // Keel is too small to hold its name: the name sits outside, and the
    // plate is floored only by its bar, not the word.
    expect(keel.labelMode).toBe("outside");
    expect(keel.plateR).toBeLessThan(60);
    expect(grove.labelMode).toBe("inside");
    // Gross-revenue pill outside the plate (above, or below for the 12 o'clock
    // plate whose top touches the frame), anchored on its rim.
    for (const p of [grove, spark, keel]) {
      expect(Math.abs(p.grossPillY - p.plateY)).toBeGreaterThan(p.plateR);
      expect(p.grossPillY).toBeGreaterThan(11);
      expect(Math.hypot(p.grossAnchorX - p.plateX, p.grossAnchorY - p.plateY)).toBeLessThanOrEqual(p.plateR);
    }
  });

  it("lets a Prime outrank the donut when it earns more than Sky takes", () => {
    const layout = layoutMscRing([flow({ sky: 1_000_000, kept: 8_000_000, demand: 1_000_000 })]);
    expect(layout.primes[0].plateR).toBe(200);
    expect(layout.skyR).toBeLessThan(200);
    expect(layout.skyR).toBeGreaterThanOrEqual(80);
  });

  it("names a prime to the left of its zero line when it fits, else centered outside its plate", () => {
    const layout = layoutMscRing(JULY, (p) => p.toUpperCase());
    for (const p of layout.primes) {
      if (p.labelMode === "inside") {
        expect(p.labelAnchor).toBe("end");
        expect(p.labelX).toBeLessThan(p.zeroX0);
        expect(p.labelY).toBeCloseTo(p.zeroY, 6);
        // …and the plate encloses both the bar and the label.
        const labelLeft = p.labelX - p.prime.length * 9.5;
        expect(Math.hypot(labelLeft - p.plateX, p.zeroY - p.plateY)).toBeLessThanOrEqual(p.plateR);
      } else {
        expect(p.labelAnchor).toBe("middle");
        expect(p.labelX).toBeCloseTo(p.plateX, 6);
        expect(Math.abs(p.labelY - p.plateY)).toBeGreaterThan(p.plateR);
        // The gross pill never lands on the outside name.
        expect(Math.sign(p.grossPillY - p.plateY)).not.toBe(Math.sign(p.labelY - p.plateY));
      }
      for (const s of p.segments) {
        expect(Math.hypot(s.x + s.w - p.plateX, s.y - p.plateY)).toBeLessThanOrEqual(p.plateR);
        expect(Math.hypot(s.x + s.w - p.plateX, s.y + s.h - p.plateY)).toBeLessThanOrEqual(p.plateR);
      }
    }
    // The smallest (osero, keel) are the outside ones; the big ones inside.
    expect(layout.primes.find((p) => p.prime === "osero")!.labelMode).toBe("outside");
    expect(layout.primes.find((p) => p.prime === "spark")!.labelMode).toBe("inside");
  });

  it("keeps every plate inside the fixed frame, clear of the donut and of each other", () => {
    for (const month of [JULY, APRIL, JANUARY, [flow(), flow({ prime: "grove", sky: 9_000_000, kept: -2_000_000 })]]) {
      const layout = layoutMscRing(month);
      for (let i = 0; i < layout.primes.length; i++) {
        const a = layout.primes[i];
        expect(a.plateX - a.plateR).toBeGreaterThan(0);
        expect(a.plateX + a.plateR).toBeLessThan(WIDTH);
        expect(a.plateY - a.plateR).toBeGreaterThan(0);
        expect(a.plateY + a.plateR).toBeLessThan(layout.height);
        expect(Math.hypot(a.plateX - layout.cx, a.plateY - layout.cy)).toBeGreaterThan(layout.skyR + a.plateR);
        for (let j = i + 1; j < layout.primes.length; j++) {
          const b = layout.primes[j];
          expect(Math.hypot(a.plateX - b.plateX, a.plateY - b.plateY)).toBeGreaterThanOrEqual(a.plateR + b.plateR - 1e-6);
        }
      }
    }
  });

  it("keeps To Sky out of the bar: it is a pass-through, not revenue", () => {
    const layout = layoutMscRing([flow()]);
    expect(layout.primes[0].segments.map((s) => s.kind)).toEqual(["kept", "demand"]);
    expect(layout.primes[0].arrow!.kind).toBe("sky");
  });

  it("carries both To-Sky components on the arrow for its hover", () => {
    // Grove, Apr 2026: cof 2.95M, sde 6.40M.
    const layout = layoutMscRing([flow({ prime: "grove", sky: 9_340_000, cof: 2_950_000, sde: 6_400_000 })]);
    const arrow = layout.primes[0].arrow!;
    expect(arrow.cof).toBe(2_950_000);
    expect(arrow.sde).toBe(6_400_000);
  });

  it("keeps the primes in the order given, clockwise from 12 o'clock, non-contributors between their neighbours", () => {
    // PRIME_ORDER as the caller passes it (Atlas doc order): spark, grove,
    // keel, skybase, obex, osero.
    const layout = layoutMscRing([
      flow({ prime: "spark", sky: 5_750_694, kept: 2_846_722, demand: 1_074_583 }),
      flow({ prime: "grove", sky: 8_003_550, kept: 1_563_759, demand: 114_024 }),
      flow({ prime: "keel", sky: 0, kept: 0, demand: 36_000 }),
      flow({ prime: "skybase", sky: 0, kept: 0, demand: 238_107 }),
      flow({ prime: "obex", sky: 1_761_245, kept: 764_735, demand: 71_997 }),
      flow({ prime: "osero", sky: 497, kept: -107, demand: 12_149 }),
    ]);
    expect(layout.primes.map((p) => p.prime)).toEqual(["spark", "grove", "keel", "skybase", "obex", "osero"]);
    expect(layout.skyWedges.map((w) => w.prime)).toEqual(["spark", "grove", "obex", "osero"]);
    // Clockwise (increasing angle from 12 o'clock) follows that order.
    const turns = layout.primes.map((p) => ((p.angle + Math.PI / 2) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI));
    for (let i = 1; i < turns.length; i++) expect(turns[i]).toBeGreaterThan(turns[i - 1]);
    // Spark, first, is at the top.
    expect(turns[0]).toBeLessThan(0.05);
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
        expect(Number.isFinite(p.arrow.amountX)).toBe(true);
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
