import { describe, it, expect } from "vitest";
import { layoutMscFlow, AGENT_LINE_H, AGENT_W, GROUP_HEADING, GROUP_HEADING_SIZE, HEADER_SIZE, HEADERS, LABEL_X, LEFT_X, NODE_W, owedBySky, PIPE_SPACE, SKY_LABEL_ROOM, SKY_LABEL_X, SKY_PIPE_SPACE, sourceBarX, sourceBracket, sourceLabelWidth, WIDTH } from "./mscFlowLayout";
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
    expect(HEADER_SIZE).toBeGreaterThan(GROUP_HEADING_SIZE);
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
    // Its whole bar is money SKY OWES IT (A.2.4.1.2.2.1.1.1), so every row
    // is bracketed rather than left to look earned.
    expect(l.sources.every((s) => s.origin === "sky")).toBe(true);
    const b = sourceBracket(l.sources)!;
    expect(b).not.toBeNull();
    expect(b.value).toBeCloseTo(36_231);
    expect(owedBySky(l.sources)).toBeCloseTo(36_231);
    // It spans every Sky-owed row, labels included, and stands clear of both
    // the labels and the bars.
    expect(b.y0).toBeLessThanOrEqual(Math.min(...l.sources.map((s) => s.y)));
    expect(b.y1).toBeGreaterThanOrEqual(Math.max(...l.sources.map((s) => s.y + s.h)));
    expect(b.x + b.arm).toBeLessThanOrEqual(LABEL_X);
    // A `[`: an arm in at the top, the spine, an arm in at the bottom.
    expect(b.path).toBe(`M${b.x + b.arm},${b.y0} H${b.x} V${b.y1} H${b.x + b.arm}`);
  });

  it("draws no bracket around a group of one, or none at all", () => {
    // One demand series only — a bracket round a single row is a stray glyph.
    const one = layoutMscFlow([flow({ prime: "keel", sky: 0, cof: 0, sde: 0, kept: 0, demand: 32_004, demandParts: { agentRate: 32_004 } })]);
    expect(one.sources.map((s) => s.kind)).toEqual(["agentRate"]);
    expect(sourceBracket(one.sources)).toBeNull();
    // ...but the heading's total is still there to say whose it is.
    expect(owedBySky(one.sources)).toBeCloseTo(32_004);
    const none = layoutMscFlow([flow({ demand: 0, demandParts: {} })]);
    expect(sourceBracket(none.sources)).toBeNull();
    expect(owedBySky(none.sources)).toBe(0);
  });

  it("splits the source column by origin, and brackets only what Sky owes", () => {
    const l = layoutMscFlow([flow(), flow({ prime: "grove" })]);
    // Earned first, Sky-owed after — the order KINDS already uses.
    expect(l.sources.map((s) => [s.kind, s.origin])).toEqual([
      ["cof", "earned"], ["sde", "earned"], ["kept", "earned"],
      ["agentRate", "sky"], ["distributionRewards", "sky"],
    ]);
    // ONLY the Sky-owed group is headed: the earned group's line items name
    // themselves, and the blank band above the seam separates the two.
    expect(l.sources.filter((s) => s.headingY != null).map((s) => s.kind)).toEqual(["agentRate"]);
    expect(GROUP_HEADING).toEqual({ sky: "OWED BY SKY" });
    // Every left-hand label starts at the same x, flush left.
    expect(l.sources.map((s) => s.labelX)).toEqual(l.sources.map(() => LABEL_X));
    // The bracket gathers the Sky-owed rows and nothing else.
    const b = sourceBracket(l.sources)!;
    const owed = l.sources.filter((s) => s.origin === "sky");
    expect(b.y0).toBeLessThanOrEqual(owed[0].y);
    expect(b.y1).toBeGreaterThanOrEqual(owed[owed.length - 1].y + owed[owed.length - 1].h);
    expect(b.y0).toBeGreaterThan(l.sources[0].y + l.sources[0].h);
    // A supply-only month is not bracketed at all.
    const supplyOnly = layoutMscFlow([flow({ demand: 0, demandParts: {} })]);
    expect(supplyOnly.sources.every((s) => s.origin === "earned")).toBe(true);
    expect(sourceBracket(supplyOnly.sources)).toBeNull();
  });

  it("anchors the three columns left / pipe-centred / right, and spends the slack on the ribbons", () => {
    const l = layoutMscFlow([flow(), flow({ prime: "grove" })]);
    // LEFT: every label starts flush at LABEL_X and its own bar follows it
    // — the bars are a stagger, not a column.
    for (const s of l.sources) {
      expect(s.labelX).toBe(LABEL_X);
      expect(s.x).toBe(sourceBarX(s.kind));
      expect(s.x - (LABEL_X + sourceLabelWidth(s.kind))).toBeCloseTo(l.sources[0].x - (LABEL_X + sourceLabelWidth("cof")), 6);
    }
    // The longest label (cost of funds) owns the rightmost bar, which is the
    // left boundary everything downstream is measured from.
    expect(Math.max(...l.sources.map((s) => s.x))).toBe(LEFT_X);
    expect(l.sources.find((s) => s.kind === "cof")!.x).toBe(LEFT_X);
    // Bar x follows label length: strictly ordered, ties only where two
    // labels measure the same.
    const byLen = [...l.sources].sort((a, b2) => sourceLabelWidth(a.kind) - sourceLabelWidth(b2.kind));
    for (let i = 1; i < byLen.length; i++) {
      const wider = sourceLabelWidth(byLen[i].kind) > sourceLabelWidth(byLen[i - 1].kind);
      if (wider) expect(byLen[i].x).toBeGreaterThan(byLen[i - 1].x);
      else expect(byLen[i].x).toBe(byLen[i - 1].x);
    }
    expect(byLen[byLen.length - 1].x).toBeGreaterThan(byLen[0].x);
    // RIGHT: the To Sky line ends at the canvas' right margin, clear of the
    // bar, which is why the gutter is no wider than that line needs.
    expect(l.sky.x + NODE_W).toBeLessThan(SKY_LABEL_X);
    // Both ends keep at least the air that sits either side of the label's
    // own pipe between the text and the bar it names — below that they read
    // as touching. The left gap is the stagger's own gap; the right one is
    // what is left of the gutter once the To Sky line has had its width.
    for (const s of l.sources) {
      expect(s.x - (LABEL_X + sourceLabelWidth(s.kind))).toBeGreaterThanOrEqual(PIPE_SPACE);
    }
    expect(SKY_LABEL_X - SKY_LABEL_ROOM - (l.sky.x + NODE_W)).toBeGreaterThanOrEqual(SKY_PIPE_SPACE);
    // The To Sky line is set larger, so its floor is larger too.
    expect(SKY_PIPE_SPACE).toBeGreaterThan(PIPE_SPACE);
    expect(SKY_LABEL_X).toBeLessThan(WIDTH);
    // The gap between bars has to clear the label block above the lower one
    // (two 42px lines); if it ever stops, the names sit on the bar above.
    const six = layoutMscFlow(["spark", "grove", "keel", "skybase", "obex", "osero"].map((p, i) =>
      flow({ prime: p, sky: 10_000_000 / (i + 1), kept: 2_000_000 / (i + 1), cof: 9_900_000 / (i + 1) })));
    for (let i = 1; i < six.agents.length; i++) {
      const gap = six.agents[i].y - (six.agents[i - 1].y + six.agents[i - 1].h);
      expect(gap).toBeGreaterThan(2 * AGENT_LINE_H);
    }
    // CENTRE: every Prime's label is anchored on the same x — the column's
    // centre — so the names line up without depending on how wide they are.
    const centres = new Set(l.agents.map((a) => a.labelX));
    expect(centres.size).toBe(1);
    expect([...centres][0]).toBeCloseTo(l.agents[0].x + AGENT_W / 2, 6);
    // The ribbon span is most of the canvas, not a pair of fat gutters.
    // (The gutters are label-width plus one pipe-space of air, so this is a
    // floor on the drawing, not a target — the room either side of the
    // canvas that useSvgZoom's filled base reclaims is on top of it.)
    expect(l.sky.x - (LEFT_X + NODE_W)).toBeGreaterThan(WIDTH * 0.41);
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

  it("spreads the source and Prime bars over the canvas height with equal gaps, and centers Sky on it", () => {
    const l = layoutMscFlow([flow(), flow({ prime: "grove" }), flow({ prime: "keel" }), flow({ prime: "obex" })]);
    // Space-between: first bars share the top edge, the last ones reach the
    // bottom (the source column stops short by half a label block so the
    // last label stays on the canvas), and every gap in a column is equal.
    expect(l.sources[0].y).toBe(l.agents[0].y);
    const lastA = l.agents[l.agents.length - 1];
    const lastS = l.sources[l.sources.length - 1];
    expect(lastA.y + lastA.h).toBeGreaterThan(l.height * 0.95);
    expect(lastS.y + lastS.h).toBeGreaterThan(l.height * 0.9);
    expect(lastS.labelY).toBeLessThan(l.height);
    const gaps = (bars: { y: number; h: number }[]) => bars.slice(1).map((b, i) => b.y - (bars[i].y + bars[i].h));
    for (const x of gaps(l.agents)) expect(x).toBeCloseTo(gaps(l.agents)[0], 6);
    // The source column is two groups, so its gaps are equal WITHIN a group
    // and wider across the seam between earned and Sky-owed.
    const srcGaps = gaps(l.sources);
    const seam = l.sources.findIndex((s) => s.origin === "sky") - 1;
    expect(seam).toBeGreaterThanOrEqual(0);
    const within = srcGaps.filter((_, i) => i !== seam);
    for (const x of within) expect(x).toBeCloseTo(within[0], 6);
    expect(srcGaps[seam]).toBeGreaterThan(within[0] + 50);
    const agentsMid = (l.agents[0].y + lastA.y + lastA.h) / 2;
    expect(l.sky.y + l.sky.h / 2).toBeCloseTo(agentsMid, 0);
  });
});
