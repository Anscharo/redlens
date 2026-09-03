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

describe("layoutMscRing (orbital)", () => {
  it("returns an empty layout for no primes or all-zero flows", () => {
    expect(layoutMscRing([]).primes).toEqual([]);
    expect(layoutMscRing([flow({ sky: 0, kept: 0, demand: 0 })]).primes).toEqual([]);
  });

  it("sizes circles so area ∝ √(total funds through the prime)", () => {
    const layout = layoutMscRing([
      flow(), // total 13.5M
      flow({ prime: "obex", sky: 100_000, kept: 30_000, demand: 5_000 }), // total 135k
    ]);
    const [spark, obex] = layout.primes;
    // r ∝ total^(1/4)  ⇒  area ∝ total^(1/2). 100× total ⇒ ~3.16× radius.
    expect(spark.r / obex.r).toBeCloseTo(Math.sqrt(Math.sqrt(100)), 1);
    // Sky is sized on the same scale from Σ|sky|.
    expect(layout.skyR).toBeGreaterThan(spark.r * 0.8);
  });

  it("floors tiny circles so a $497 prime stays visible", () => {
    const layout = layoutMscRing([
      flow({ sky: 58_000_000 }),
      flow({ prime: "osero", sky: 497, kept: -107, demand: 300 }),
    ]);
    const osero = layout.primes.find((p) => p.prime === "osero")!;
    expect(osero.r).toBeGreaterThanOrEqual(13);
  });

  it("places circles on the orbit without overlap and inside the viewBox", () => {
    const layout = layoutMscRing([
      flow(),
      flow({ prime: "grove", sky: 9_000_000 }),
      flow({ prime: "obex", sky: 2_000_000, kept: 400_000, demand: 70_000 }),
      flow({ prime: "keel", sky: 0, kept: 0, demand: 280_000 }),
    ]);
    for (let i = 0; i < layout.primes.length; i++) {
      const a = layout.primes[i];
      expect(a.cx - a.r).toBeGreaterThan(0);
      expect(a.cx + a.r).toBeLessThan(WIDTH);
      expect(a.cy - a.r).toBeGreaterThan(0);
      expect(a.cy + a.r).toBeLessThan(layout.height);
      for (let j = i + 1; j < layout.primes.length; j++) {
        const b = layout.primes[j];
        const d = Math.hypot(a.cx - b.cx, a.cy - b.cy);
        expect(d).toBeGreaterThanOrEqual(a.r + b.r - 1e-6);
      }
      // No circle overlaps the Sky circle.
      const dSky = Math.hypot(a.cx - layout.cx, a.cy - layout.cy);
      expect(dSky).toBeGreaterThanOrEqual(a.r + layout.skyR);
    }
  });

  it("drops near-zero flows but keeps the prime (demand-only Keel/Skybase)", () => {
    const layout = layoutMscRing([flow({ prime: "keel", sky: 0, kept: 0, demand: 280_000 })]);
    expect(layout.primes).toHaveLength(1);
    expect(layout.primes[0].flows.map((f) => f.kind)).toEqual(["demand"]);
  });

  it("marks negative kept/demand flows inward with the sign preserved", () => {
    const layout = layoutMscRing([flow({ prime: "osero", sky: 497, kept: -107, demand: 12_000 })]);
    const kept = layout.primes[0].flows.find((f) => f.kind === "kept")!;
    expect(kept.signed).toBe(-107);
    expect(kept.value).toBe(107);
    expect(kept.inward).toBe(true);
    const demand = layout.primes[0].flows.find((f) => f.kind === "demand")!;
    expect(demand.inward).toBe(false);
  });

  it("emits valid ribbon paths and finite label/amount anchors", () => {
    const layout = layoutMscRing([flow()]);
    const [p] = layout.primes;
    for (const f of p.flows) {
      expect(f.path).not.toMatch(/NaN/);
      expect(f.path).toMatch(/^M/);
      expect(Number.isFinite(f.amountX)).toBe(true);
      expect(Number.isFinite(f.amountY)).toBe(true);
    }
    expect(Number.isFinite(p.labelX)).toBe(true);
    expect(Number.isFinite(p.labelY)).toBe(true);
  });

  it("puts a fitting name inside the circle and long/tiny ones in side callouts", () => {
    const layout = layoutMscRing(
      [flow(), flow({ prime: "osero", sky: 497, kept: -107, demand: 12_000 })],
      (p) => (p === "spark" ? "Spark" : "Osero With A Very Long Display Name"),
    );
    const spark = layout.primes.find((p) => p.prime === "spark")!;
    expect(spark.labelMode).toBe("circle");
    expect(spark.labelAnchor).toBe("middle");
    expect(spark.leaderPath).toBe("");
    const osero = layout.primes.find((p) => p.prime === "osero")!;
    expect(osero.labelMode).toBe("callout");
    expect(osero.leaderPath).toMatch(/^M/);
    expect(osero.leaderPath).not.toMatch(/NaN/);
  });

  it("keeps same-side callout labels separated", () => {
    const longName = (p: string) => `${p} settlement prime display name`;
    const layout = layoutMscRing(
      [
        flow(),
        flow({ prime: "grove", sky: 9_000_000 }),
        flow({ prime: "obex", sky: 8_000_000 }),
        flow({ prime: "keel", sky: 0, kept: 0, demand: 280_000 }),
        flow({ prime: "osero", sky: 497, kept: -107, demand: 12_000 }),
      ],
      longName,
    );
    const callouts = layout.primes.filter((p) => p.labelMode === "callout");
    expect(callouts.length).toBe(layout.primes.length); // long names never fit a circle
    for (const anchor of ["start", "end"] as const) {
      const ys = callouts
        .filter((p) => p.labelAnchor === anchor)
        .map((p) => p.labelY)
        .sort((a, b) => a - b);
      for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(15 - 1e-9);
    }
  });

  it("is deterministic for the same input", () => {
    const primes = [flow(), flow({ prime: "grove" })];
    expect(layoutMscRing(primes)).toEqual(layoutMscRing(primes));
  });
});
