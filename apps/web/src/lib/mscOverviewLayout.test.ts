import { describe, it, expect } from "vitest";
import { layoutMscRing, WIDTH, HEIGHT } from "./mscOverviewLayout";
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

const GAP = 0.16;

describe("layoutMscRing", () => {
  it("returns an empty layout for no primes or all-zero flows", () => {
    expect(layoutMscRing([]).primes).toEqual([]);
    expect(layoutMscRing([]).dividers).toEqual([]);
    expect(layoutMscRing([flow({ sky: 0, kept: 0, demand: 0 })]).primes).toEqual([]);
  });

  it("fills the circle: wedges plus gaps sum to 2π, one divider per gap", () => {
    const layout = layoutMscRing([
      flow(),
      flow({ prime: "grove", sky: 8_000_000 }),
      flow({ prime: "obex", sky: 2_000_000, kept: 400_000, demand: 70_000 }),
    ]);
    const total = layout.primes.reduce((t, p) => t + (p.a1 - p.a0) + GAP, 0);
    expect(total).toBeCloseTo(2 * Math.PI, 6);
    expect(layout.width).toBe(WIDTH);
    expect(layout.height).toBe(HEIGHT);
    expect(layout.dividers).toHaveLength(3);
    for (const d of layout.dividers) {
      for (const v of [d.x1, d.y1, d.x2, d.y2]) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("floors a tiny prime's wedge so it stays visible next to a giant", () => {
    const layout = layoutMscRing([
      flow({ sky: 58_000_000 }),
      flow({ prime: "osero", sky: 497, kept: -107, demand: 12_000 }),
    ]);
    const osero = layout.primes.find((p) => p.prime === "osero")!;
    expect(osero.a1 - osero.a0).toBeGreaterThanOrEqual(0.14 - 1e-9);
    // Every rendered flow honors the per-flow floor.
    for (const p of layout.primes) {
      for (const f of p.flows) expect(f.a1 - f.a0).toBeGreaterThanOrEqual(0.035 - 1e-9);
    }
  });

  it("drops near-zero flows but keeps the prime (demand-only Keel/Skybase)", () => {
    const layout = layoutMscRing([flow({ prime: "keel", sky: 0, kept: 0, demand: 280_000 })]);
    expect(layout.primes).toHaveLength(1);
    expect(layout.primes[0].flows.map((f) => f.kind)).toEqual(["demand"]);
  });

  it("reverses a negative kept/demand flow into the band, keeping its sign", () => {
    const layout = layoutMscRing([flow({ prime: "osero", sky: 497, kept: -107, demand: 12_000 })]);
    const [p] = layout.primes;
    const kept = p.flows.find((f) => f.kind === "kept")!;
    expect(kept.signed).toBe(-107);
    expect(kept.value).toBe(107);
    expect(kept.inward).toBe(true);
    expect(kept.path).toMatch(/^M/);
    expect(kept.path).not.toMatch(/NaN/);
    // Positive flows still point their usual way.
    expect(p.flows.find((f) => f.kind === "sky")!.inward).toBe(false);
    expect(p.flows.find((f) => f.kind === "demand")!.inward).toBe(false);
  });

  it("orders flows kept, sky, demand with gaps, and emits valid paths", () => {
    const layout = layoutMscRing([flow()]);
    const [p] = layout.primes;
    expect(p.flows.map((f) => f.kind)).toEqual(["kept", "sky", "demand"]);
    // Flow slices are separated (a gap between consecutive slices) and end at a1.
    expect(p.flows[1].a0).toBeGreaterThan(p.flows[0].a1);
    expect(p.flows[2].a1).toBeCloseTo(p.a1, 6);
    for (const s of [p.arcPath, ...p.flows.map((f) => f.path)]) {
      expect(s).not.toMatch(/NaN/);
      expect(s).toMatch(/^M/);
    }
    expect(Number.isFinite(p.labelX)).toBe(true);
    expect(Number.isFinite(p.labelY)).toBe(true);
  });

  it("puts a fitting name inside the band and long/tiny ones in side callouts", () => {
    const layout = layoutMscRing(
      [flow(), flow({ prime: "osero", sky: 497, kept: -107, demand: 12_000 })],
      (p) => (p === "spark" ? "Spark" : "Osero With A Very Long Display Name"),
    );
    const spark = layout.primes.find((p) => p.prime === "spark")!;
    expect(spark.labelMode).toBe("band");
    expect(spark.labelAnchor).toBe("middle");
    expect(spark.leaderPath).toBe("");
    const osero = layout.primes.find((p) => p.prime === "osero")!;
    expect(osero.labelMode).toBe("callout");
    expect(osero.leaderPath).toMatch(/^M/);
    expect(osero.leaderPath).not.toMatch(/NaN/);
  });

  it("assigns side-anchored callout labels and keeps same-side labels separated", () => {
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
    // Floored tiny wedges can never fit a name in the band.
    for (const prime of ["keel", "osero"]) {
      expect(layout.primes.find((p) => p.prime === prime)!.labelMode).toBe("callout");
    }
    for (const anchor of ["start", "end"] as const) {
      const ys = callouts
        .filter((p) => p.labelAnchor === anchor)
        .map((p) => p.labelY)
        .sort((a, b) => a - b);
      for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(15 - 1e-9);
    }
    // Start-anchored labels sit in the right column, end-anchored in the left.
    for (const p of callouts) {
      if (p.labelAnchor === "start") expect(p.labelX).toBeGreaterThan(layout.cx);
      else expect(p.labelX).toBeLessThan(layout.cx);
    }
  });

  it("is deterministic for the same input", () => {
    const primes = [flow(), flow({ prime: "grove" })];
    expect(layoutMscRing(primes)).toEqual(layoutMscRing(primes));
  });
});
