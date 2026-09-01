import { describe, it, expect } from "vitest";
import { layoutMscRing, SIZE } from "./mscOverviewLayout";
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

const GAP = 0.1;

describe("layoutMscRing", () => {
  it("returns an empty layout for no primes or all-zero flows", () => {
    expect(layoutMscRing([]).primes).toEqual([]);
    expect(layoutMscRing([flow({ sky: 0, kept: 0, demand: 0 })]).primes).toEqual([]);
  });

  it("fills the circle: wedges plus gaps sum to 2π", () => {
    const layout = layoutMscRing([
      flow(),
      flow({ prime: "grove", sky: 8_000_000 }),
      flow({ prime: "obex", sky: 2_000_000, kept: 400_000, demand: 70_000 }),
    ]);
    const total = layout.primes.reduce((t, p) => t + (p.a1 - p.a0) + GAP, 0);
    expect(total).toBeCloseTo(2 * Math.PI, 6);
    expect(layout.size).toBe(SIZE);
  });

  it("floors a tiny prime's wedge so it stays visible next to a giant", () => {
    const layout = layoutMscRing([
      flow({ sky: 58_000_000 }),
      flow({ prime: "osero", sky: 497, kept: -107, demand: 12_000 }),
    ]);
    const osero = layout.primes.find((p) => p.prime === "osero")!;
    expect(osero.a1 - osero.a0).toBeGreaterThanOrEqual(0.12 - 1e-9);
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

  it("keeps the sign on negative flows for loss styling", () => {
    const layout = layoutMscRing([flow({ prime: "osero", sky: 497, kept: -107, demand: 12_000 })]);
    const kept = layout.primes[0].flows.find((f) => f.kind === "kept")!;
    expect(kept.signed).toBe(-107);
    expect(kept.value).toBe(107);
  });

  it("orders flows kept, sky, demand and emits valid paths", () => {
    const layout = layoutMscRing([flow()]);
    const [p] = layout.primes;
    expect(p.flows.map((f) => f.kind)).toEqual(["kept", "sky", "demand"]);
    for (const s of [p.arcPath, ...p.flows.map((f) => f.path)]) {
      expect(s).not.toMatch(/NaN/);
      expect(s).toMatch(/^M.*Z$/);
    }
    expect(Number.isFinite(p.labelX)).toBe(true);
    expect(Number.isFinite(p.labelY)).toBe(true);
  });

  it("is deterministic for the same input", () => {
    const primes = [flow(), flow({ prime: "grove" })];
    expect(layoutMscRing(primes)).toEqual(layoutMscRing(primes));
  });
});
