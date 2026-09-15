import { describe, it, expect } from "vitest";
import { layoutMscFlow } from "./mscFlowLayout";
import { easeInOut, tweenFlowLayout } from "./mscFlowTween";
import type { PrimeFlowTotals } from "@/lib/settlementsOverview";

const flow = (over: Partial<PrimeFlowTotals> = {}): PrimeFlowTotals => ({
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
});

describe("tweenFlowLayout", () => {
  const june = layoutMscFlow([flow({ sky: 5_000_000, cof: 4_950_000, sde: 50_000, kept: 1_000_000 })]);
  const july = layoutMscFlow([flow(), flow({ prime: "grove", sky: 4_000_000, cof: 4_000_000, sde: 0, kept: 500_000, demand: 0, demandParts: {} })]);

  it("is the from layout at 0 and the to layout at 1", () => {
    expect(tweenFlowLayout(june, july, 0)).toBe(june);
    expect(tweenFlowLayout(june, july, 1)).toBe(july);
  });

  it("interpolates a bar's place and height, and a ribbon's thickness and endpoints, halfway", () => {
    const mid = tweenFlowLayout(june, july, 0.5);
    const a = june.agents[0];
    const b = july.agents[0];
    const m = mid.agents[0];
    expect(m.prime).toBe("spark");
    expect(m.y).toBeCloseTo((a.y + b.y) / 2);
    expect(m.h).toBeCloseTo((a.h + b.h) / 2);
    expect(m.gross).toBeCloseTo((a.gross + b.gross) / 2);
    const la = a.inbound.find((l) => l.kind === "cof")!;
    const lb = b.inbound.find((l) => l.kind === "cof")!;
    const lm = m.inbound.find((l) => l.kind === "cof")!;
    expect(lm.geom.t).toBeCloseTo((la.geom.t + lb.geom.t) / 2);
    expect(lm.geom.y1).toBeCloseTo((la.geom.y1 + lb.geom.y1) / 2);
    expect(lm.geom.x0).toBe(lb.geom.x0);
    // The path is regenerated from the tweened geometry.
    expect(lm.path.startsWith(`M${lm.geom.x0},${lm.geom.y0}`)).toBe(true);
    expect(lm.value).toBeCloseTo((la.value + lb.value) / 2);
    expect(lm.figureX).toBeNull();
    // Sky's bar and its per-Prime segments move with it.
    expect(mid.sky.h).toBeCloseTo((june.sky.h + july.sky.h) / 2);
    expect(mid.sky.total).toBeCloseTo((june.sky.total + july.sky.total) / 2);
  });

  it("grows a Prime that is new this month from a flat bar at its own place", () => {
    const early = tweenFlowLayout(june, july, 0.25);
    const grove = early.agents.find((a) => a.prime === "grove")!;
    const target = july.agents.find((a) => a.prime === "grove")!;
    expect(grove.h).toBeCloseTo(target.h * 0.25);
    expect(grove.y).toBeCloseTo(target.y);
    // Fading in with its bar; the Prime that stays is left opaque.
    expect(grove.alpha).toBeCloseTo(0.25);
    expect(early.agents.find((a) => a.prime === "spark")!.alpha).toBeUndefined();
    for (const l of grove.inbound) {
      const t = target.inbound.find((x) => x.kind === l.kind)!;
      expect(l.geom.t).toBeCloseTo(t.geom.t * 0.25);
    }
    expect(early.sky.shares.find((s) => s.prime === "grove")!.h).toBeCloseTo(july.sky.shares.find((s) => s.prime === "grove")!.h * 0.25);
  });

  it("shrinks a Prime that has left to a flat bar, kept after the ones that stay", () => {
    const late = tweenFlowLayout(july, june, 0.75);
    expect(late.agents.map((a) => a.prime)).toEqual(["spark", "grove"]);
    const grove = late.agents[1];
    const was = july.agents.find((a) => a.prime === "grove")!;
    expect(grove.h).toBeCloseTo(was.h * 0.25);
    expect(grove.outbound[0].geom.t).toBeCloseTo(was.outbound[0].geom.t * 0.25);
    expect(grove.alpha).toBeCloseTo(0.25);
    expect(late.sky.shares.find((s) => s.prime === "grove")!.alpha).toBeCloseTo(0.25);
    // A source only that Prime fed thins out the same way.
    expect(late.sources.map((s) => s.kind)).toEqual(june.sources.map((s) => s.kind));
  });

  it("eases in and out, symmetrically", () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5);
    expect(easeInOut(0.25)).toBeCloseTo(1 - easeInOut(0.75));
    expect(easeInOut(0.1)).toBeLessThan(0.1);
  });
});
