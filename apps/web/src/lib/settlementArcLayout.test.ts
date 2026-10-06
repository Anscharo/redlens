import { describe, expect, it } from "vitest";
import type { StreamModel, VenueStream } from "@/lib/settlementStreams";
import { BAND, CX, CY, OUTER0, PRIME_HALF, layoutSettlementArc } from "./settlementArcLayout";
import { ARC_OTHER_ID, ARC_TOP_N, arcSources } from "./settlementArcRows";

const venue = (id: string, revenue: number, cof: number, sde = 0): VenueStream => ({ id, label: id, synthetic: false, revenue, sde, cof, kept: revenue - cof });

function model(venues: VenueStream[], demand: StreamModel["demand"] = []): StreamModel {
  const sum = (k: "revenue" | "cof" | "sde" | "kept") => venues.reduce((n, v) => n + v[k], 0);
  const demandTotal = demand.reduce((n, d) => n + d.value, 0);
  return { venues, revenue: sum("revenue"), cof: sum("cof"), sde: sum("sde"), toSky: sum("cof") + sum("sde"), kept: sum("kept"), demand, demandTotal };
}

/** An arc path's start and end points and its sweep flag. */
function arc(d: string) {
  const pt = (s: string) => s.split(",").map(Number);
  const [m, a] = d.slice(1).split(" A");
  const parts = a.split(" ");
  return { from: pt(m), to: pt(parts[4]), sweep: Number(parts[3]) };
}

describe("arcSources", () => {
  it("lists each venue's revenue, largest first, folding the tail into Other", () => {
    const vs = Array.from({ length: ARC_TOP_N + 3 }, (_, i) => venue(`V${i}`, 100 + i, 10));
    const { revenue } = arcSources(model(vs));
    expect(revenue).toHaveLength(ARC_TOP_N + 1);
    expect(revenue[0]).toMatchObject({ key: `V${ARC_TOP_N + 2}`, venue: `V${ARC_TOP_N + 2}`, value: 100 + ARC_TOP_N + 2 });
    expect(revenue.at(-1)).toMatchObject({ key: ARC_OTHER_ID, value: 100 + 101 + 102 });
  });

  it("lists SDE apart, keyed so a venue with both gets two bands", () => {
    const { revenue, sde } = arcSources(model([venue("A", 100, 50, 30), venue("B", 0, 0, 40)]));
    expect(revenue.map((r) => r.key)).toEqual(["A"]);
    expect(sde.map((r) => [r.key, r.venue])).toEqual([["B::sde", "B"], ["A::sde", "A"]]);
  });
});

describe("layoutSettlementArc", () => {
  it("pools venue revenue at the Prime bar's left side and sends cost of funds on to Sky", () => {
    const l = layoutSettlementArc(model([venue("A", 100, 60), venue("B", 20, 0)]));
    for (const v of l.revenue) {
      const a = arc(v.d);
      expect(a.sweep).toBe(1);
      expect(a.to[0]).toBeLessThan(CX - PRIME_HALF);
    }
    expect(l.lanes.revenue?.head).toMatch(/Z$/);
    const cof = arc(l.cof!.d);
    expect(cof.from[0] - CX).toBeCloseTo(PRIME_HALF, 0);
    expect(cof.to[1]).toBeGreaterThan(CY - 30);
    // One scale: revenue 120 fills BAND, cost of funds is half of it.
    expect(l.cof!.w).toBeCloseTo(BAND / 2);
    expect(l.cof!.r).toBeCloseTo(OUTER0 + BAND / 4);
  });

  it("draws what is kept as a stub just past the bar, the width the pool has left", () => {
    const l = layoutSettlementArc(model([venue("A", 100, 60)]));
    expect(l.shortfall).toBeNull();
    expect(l.kept).toMatchObject({ value: 40, loss: false });
    expect(l.kept!.w).toBeCloseTo((BAND * 40) / 100);
    const k = arc(l.kept!.d);
    expect(k.from[0]).toBeGreaterThan(CX);
    expect(k.to[0] - CX).toBeLessThan(40);
  });

  it("draws a cost of funds larger than the pool as a striped shortfall entering the bar", () => {
    const l = layoutSettlementArc(model([venue("A", 70, 100)]));
    expect(l.kept).toBeNull();
    expect(l.shortfall).toMatchObject({ value: -30, loss: true });
    expect(arc(l.shortfall!.d).to[0]).toBeLessThan(CX);
    expect(l.prime!.r1).toBeCloseTo(OUTER0 + BAND);
  });

  it("runs SDE outside the pool, past the Prime to Sky, and leaves it out of the bar", () => {
    const l = layoutSettlementArc(model([venue("A", 100, 100), venue("J", 0, 0, 50)]));
    const s = l.sde[0];
    expect(s.r - s.w / 2).toBeCloseTo(l.prime!.r1);
    expect(arc(s.d).to[0]).toBeGreaterThan(CX + 100);
    expect(l.lanes.sde?.head).toMatch(/Z$/);
  });

  it("runs the demand side counterclockwise from Sky's foot up to the Prime", () => {
    const l = layoutSettlementArc(model([], [{ key: "gar", label: "GAR", value: 5 }, { key: "agentRate", label: "Agent rate", value: 5 }]));
    expect(l.revenue).toEqual([]);
    expect(l.cof).toBeNull();
    expect(l.kept).toBeNull();
    expect(l.demand.map((b) => b.key)).toEqual(["agentRate", "gar"]);
    const a = arc(l.demand[0].d);
    expect(a.sweep).toBe(0);
    expect(a.from[1]).toBeCloseTo(CY, 0);
    const tip = l.lanes.demand!.head.split(" L")[1].split(",").map(Number);
    expect(tip[0] - CX).toBeCloseTo(PRIME_HALF, 0);
    expect(l.prime!.r1 - l.prime!.r0).toBeCloseTo(BAND);
    expect(layoutSettlementArc(model([])).prime).toBeNull();
  });

  it("starts each venue band further up the arch than the one inside it", () => {
    const l = layoutSettlementArc(model([venue("A", 1000, 900), venue("B", 1, 1), venue("C", 0, 0, 5)]));
    const [a, b, c] = [...l.revenue, ...l.sde].map((v) => arc(v.d).from);
    expect(a[1]).toBeCloseTo(CY, 0);
    expect(b[1]).toBeLessThan(a[1] - 10);
    expect(c[1]).toBeLessThan(b[1] - 10);
    expect(l.revenue[1].w).toBeGreaterThanOrEqual(6);
  });
});
