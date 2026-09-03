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

  it("sizes a prime's circle by area ∝ its own revenue, not the To-Sky pass-through", () => {
    const layout = layoutMscRing([
      flow(), // revenue 3.5M (kept 2M + demand 1.5M), sky 10M
      flow({ prime: "obex", sky: 100_000, kept: 800_000, demand: 75_000 }), // revenue 875k
    ]);
    const [spark, obex] = layout.primes;
    // Area ∝ value ⇒ 4× the revenue is exactly 2× the radius.
    expect(spark.r / obex.r).toBeCloseTo(2, 1);
  });

  it("makes Sky bigger than the primes feeding it — its circle is their To-Sky flows combined", () => {
    // The real July 2026 shape: $15.5M reaches Sky, the biggest prime earns
    // $3.9M of its own. Sky has to read as the larger circle.
    const layout = layoutMscRing([
      flow({ prime: "grove", sky: 8_003_550, kept: 1_563_759, demand: 114_024 }),
      flow({ prime: "spark", sky: 5_750_694, kept: 2_846_722, demand: 1_074_583 }),
      flow({ prime: "obex", sky: 1_761_245, kept: 764_735, demand: 71_997 }),
      flow({ prime: "skybase", sky: 0, kept: 0, demand: 238_107 }),
      flow({ prime: "osero", sky: 497, kept: -107, demand: 12_149 }),
    ]);
    const biggest = Math.max(...layout.primes.map((p) => p.r));
    expect(layout.skyR / biggest).toBeGreaterThan(1.5);
  });

  it("subdivides the Sky circle into one wedge per contributing prime, together making the whole circle", () => {
    const layout = layoutMscRing([
      flow({ prime: "grove", sky: 8_000_000, kept: 1_500_000, demand: 100_000 }),
      flow({ prime: "spark", sky: 6_000_000, kept: 2_800_000, demand: 1_000_000 }),
      flow({ prime: "keel", sky: 0, kept: 0, demand: 280_000 }), // pays Sky nothing
    ]);
    expect(layout.skyWedges.map((w) => w.prime)).toEqual(["grove", "spark"]);
    // Grove sends ~57% of the To-Sky total, so it holds ~57% of the circle.
    const [grove, spark] = layout.skyWedges;
    expect(grove.value / (grove.value + spark.value)).toBeCloseTo(8 / 14, 2);
    // The biggest contributor's wedge is centered on its own prime's angle,
    // so its ribbon runs straight in.
    const groveRing = layout.primes.find((p) => p.prime === "grove")!;
    expect(Math.abs(grove.mid - groveRing.angle)).toBeLessThan(1e-6);
  });

  it("parks each hover pill off the mark it names, with the leader still on the mark", () => {
    const layout = layoutMscRing([flow(), flow({ prime: "grove", sky: 9_000_000 })]);
    for (const p of layout.primes) {
      for (const s of p.slices) {
        // Leader anchor inside the circle, pill outside it — so the pill can
        // never cover its own slice or the prime's name.
        expect(Math.hypot(s.amountX - p.cx, s.amountY - p.cy)).toBeLessThanOrEqual(p.r);
        expect(Math.hypot(s.pillX - p.cx, s.pillY - p.cy)).toBeGreaterThan(p.r);
      }
      for (const f of p.flows) {
        expect(Math.hypot(f.pillX - f.amountX, f.pillY - f.amountY)).toBeGreaterThan(20);
      }
    }
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

  it("keeps only the To-Sky ribbon; kept/demand live in the pie slices (To Sky is a pass-through, not revenue, so it never gets a wedge)", () => {
    const layout = layoutMscRing([flow()]);
    expect(layout.primes[0].flows.map((f) => f.kind)).toEqual(["sky"]);
    expect(layout.primes[0].slices.map((s) => s.kind)).toEqual(["kept", "demand"]);
  });

  it("keeps a demand-only prime as a circle with no ribbon (Keel/Skybase)", () => {
    const layout = layoutMscRing([flow({ prime: "keel", sky: 0, kept: 0, demand: 280_000 })]);
    expect(layout.primes).toHaveLength(1);
    expect(layout.primes[0].flows).toEqual([]);
    expect(layout.primes[0].slices.map((s) => s.kind)).toEqual(["demand"]);
  });

  it("moves a negative kept/demand out of the pie into a loss note, not a wedge", () => {
    const layout = layoutMscRing([flow({ prime: "osero", sky: 497, kept: -107, demand: 12_000 })]);
    const p = layout.primes[0];
    // Only the positive demand share gets a wedge — kept is excluded.
    expect(p.slices.map((s) => s.kind)).toEqual(["demand"]);
    expect(p.slices[0].signed).toBe(12_000);
    expect(p.lossNotes).toEqual([{ kind: "kept", signed: -107 }]);
  });

  it("anchors a slice's hover amount inside its own circle", () => {
    const layout = layoutMscRing([flow()]);
    const kept = layout.primes[0].slices.find((s) => s.kind === "kept")!;
    const p = layout.primes[0];
    expect(Math.hypot(kept.amountX - p.cx, kept.amountY - p.cy)).toBeLessThanOrEqual(p.r);
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
