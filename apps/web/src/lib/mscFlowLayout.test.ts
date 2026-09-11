import { describe, it, expect } from "vitest";
import { layoutMscFlow, AGENT_W, HEADERS, NODE_W, WIDTH } from "./mscFlowLayout";
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

const sum = (xs: { value: number }[]) => xs.reduce((n, x) => n + x.value, 0);

describe("layoutMscFlow", () => {
  it("is empty for no primes", () => {
    const l = layoutMscFlow([]);
    expect(l.agents).toEqual([]);
    expect(l.sources).toEqual([]);
    expect(l.sky.segments).toEqual([]);
  });

  it("feeds each Prime from one source bar per line item, in the pie's order, and sends cost of funds + SDE on to Sky", () => {
    const l = layoutMscFlow([flow(), flow({ prime: "grove", sky: 5_000_000, cof: 2_000_000, sde: 3_000_000, kept: 1_000_000, demand: 0, demandParts: {} })]);
    expect(l.sources.map((s) => s.kind)).toEqual(["cof", "sde", "kept", "agentRate", "distributionRewards"]);
    // Every source bar is the sum of what it feeds.
    for (const s of l.sources) {
      const fed = l.agents.flatMap((a) => a.inbound).filter((x) => x.kind === s.kind);
      expect(s.value).toBeCloseTo(sum(fed));
    }
    const spark = l.agents[0];
    expect(spark.inbound.map((x) => x.kind)).toEqual(["cof", "sde", "kept", "agentRate", "distributionRewards"]);
    expect(spark.outbound.map((x) => [x.kind, x.value])).toEqual([["cof", 9_900_000], ["sde", 100_000]]);
    expect(spark.loss).toBe(0);
    // No stubs: the bar is as tall as its taller side (what feeds it), and
    // the To-Sky ribbons leave its right edge from the top.
    expect(spark.outbound[0].path.startsWith(`M${spark.x + AGENT_W},${spark.y}`)).toBe(true);
    expect(spark.gross).toBe(13_500_000);
    expect(spark.share).toBeCloseTo(10 / 13.5);
    // Sky is one bar, Prime-major, cost of funds before SDE, summing to the To-Sky total.
    expect(l.sky.total).toBe(15_000_000);
    expect(l.sky.segments.map((s) => `${s.prime}:${s.kind}`)).toEqual(["spark:cof", "spark:sde", "grove:cof", "grove:sde"]);
    expect(l.sky.shares.map((s) => [s.prime, s.value])).toEqual([["spark", 10_000_000], ["grove", 5_000_000]]);
    // Segments tile the Sky bar top to bottom.
    const last = l.sky.segments[l.sky.segments.length - 1];
    expect(last.y + last.h).toBeCloseTo(l.sky.y + l.sky.h);
    // Columns sit where the view expects them.
    expect(l.sources[0].x).toBeLessThan(spark.x);
    expect(spark.x + AGENT_W).toBeLessThan(l.sky.x);
    expect(HEADERS).toEqual({ source: "SOURCE", prime: "PRIME", sky: "SKY" });
    expect(l.sky.x + NODE_W).toBeLessThan(WIDTH);
    expect(l.height).toBeGreaterThan(l.agents[1].y + l.agents[1].h);
  });

  it("shows a supply-side loss as more leaving than arriving: the source feeds cof − loss, Sky gets the full cost of funds", () => {
    // Grove, Mar 2026: cof 3.12M, SDE 3.25M, kept −2.07M, demand 0.2M.
    const l = layoutMscFlow([
      flow({ prime: "grove", sky: 6_373_855, cof: 3_122_471, sde: 3_251_384, kept: -2_066_170, demand: 198_006, demandParts: { agentRate: 6_287, distributionRewards: 191_719 } }),
    ]);
    const g = l.agents[0];
    expect(g.loss).toBeCloseTo(2_066_170);
    expect(g.inbound.find((x) => x.kind === "kept")).toBeUndefined();
    expect(g.inbound.find((x) => x.kind === "cof")?.value).toBeCloseTo(3_122_471 - 2_066_170);
    expect(g.outbound.find((x) => x.kind === "cof")?.value).toBe(3_122_471);
    expect(g.gross).toBeCloseTo(3_122_471 + 3_251_384 - 2_066_170 + 198_006);
    expect(l.sources.find((s) => s.kind === "cof")?.value).toBeCloseTo(3_122_471 - 2_066_170);
    // The To-Sky side (6.37M) outweighs everything that arrived (4.51M):
    // the bar is the outgoing side, and its left edge is partly unfed.
    const inTotal = g.inbound.reduce((n, x) => n + x.value, 0);
    const outTotal = g.outbound.reduce((n, x) => n + x.value, 0);
    expect(outTotal).toBeGreaterThan(inTotal);
    const lastIn = g.inbound[g.inbound.length - 1];
    expect(lastIn.path).toMatch(/^M/);
  });

  it("gives a demand-only Prime no To-Sky ribbon and no Sky share", () => {
    const l = layoutMscFlow([flow({ prime: "keel", sky: 0, cof: 0, sde: 0, kept: 0, demand: 36_231, demandParts: { agentRate: 32_004, distributionRewards: 4_227 } })]);
    const k = l.agents[0];
    expect(k.outbound).toEqual([]);
    expect(k.inbound.map((x) => x.kind)).toEqual(["agentRate", "distributionRewards"]);
    expect(l.sky.shares).toEqual([]);
    expect(l.sky.h).toBe(0);
  });

  it("folds a negative SDE into the loss rather than drawing it as money to Sky", () => {
    // Spark, Jul 2026: sde −5,205.
    const l = layoutMscFlow([flow({ sky: 5_794_400, cof: 5_799_604, sde: -5_205, kept: 2_838_238, demand: 1_074_766, demandParts: { agentRate: 131_356, distributionRewards: 943_410 } })]);
    const s = l.agents[0];
    expect(s.outbound.map((x) => x.kind)).toEqual(["cof"]);
    expect(s.loss).toBe(5_205);
    expect(l.sources.map((x) => x.kind)).not.toContain("sde");
  });

  it("puts a permanent figure only on a ribbon thick enough to hold it", () => {
    const l = layoutMscFlow([flow()]);
    const s = l.agents[0];
    const cof = s.inbound.find((x) => x.kind === "cof")!;
    const dr = s.inbound.find((x) => x.kind === "distributionRewards")!;
    expect(cof.figureX).not.toBeNull();
    expect(dr.figureX).toBeNull();
    // A figure lies on its ribbon, between the columns; the pill sits above the midpoint.
    expect(cof.figureX!).toBeGreaterThan(l.sources[0].x + NODE_W);
    expect(cof.figureX!).toBeLessThan(s.x);
    expect(cof.pillY).toBeLessThan(cof.midY);
  });

  it("keeps the canvas the same size whatever the month, so nothing moves between months", () => {
    const one = layoutMscFlow([flow()]);
    const six = layoutMscFlow(["spark", "grove", "keel", "skybase", "obex", "osero"].map((prime) => flow({ prime })));
    expect(one.height).toBe(six.height);
    expect(one.width).toBe(six.width);
    expect(one.agents[0].x).toBe(six.agents[0].x);
  });

  it("centers the source and Sky columns on the Prime column", () => {
    const l = layoutMscFlow([flow(), flow({ prime: "grove" }), flow({ prime: "obex" })]);
    const agentsBottom = l.agents[2].y + l.agents[2].h;
    const agentsMid = (l.agents[0].y + agentsBottom) / 2;
    expect(l.sky.y + l.sky.h / 2).toBeCloseTo(agentsMid, 0);
    const srcTop = l.sources[0].y;
    const srcBottom = l.sources[l.sources.length - 1].y + l.sources[l.sources.length - 1].h;
    expect((srcTop + srcBottom) / 2).toBeCloseTo(agentsMid, 0);
  });
});
