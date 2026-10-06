import { describe, expect, it } from "vitest";
import type { StreamModel, VenueStream } from "@/lib/settlementStreams";
import { ARRIVE_GAP, BAND, CX, CY, OUTER0, PRIME_HALF, layoutSettlementArc } from "./settlementArcLayout";
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
  it("pools venue revenue at the Prime node's left side and sends cost of funds on to Sky", () => {
    const l = layoutSettlementArc(model([venue("A", 100, 60), venue("B", 20, 0)]));
    for (const v of l.revenue) {
      const a = arc(v.d);
      expect(a.sweep).toBe(1);
      expect(a.to[0]).toBeLessThan(CX - PRIME_HALF);
    }
    expect(l.lanes.revenue?.head).toMatch(/Z$/);
    const cof = arc(l.cof!.d);
    expect(cof.from[0] - CX).toBeCloseTo(PRIME_HALF, 0);
    expect(cof.to[1]).toBeGreaterThan(CY - 60);
    // One scale: revenue 120 fills BAND, cost of funds is half of it.
    expect(l.cof!.w).toBeCloseTo(BAND / 2);
  });

  it("sizes the Prime node to the pool and fills the part no band leaves as kept", () => {
    const l = layoutSettlementArc(model([venue("A", 100, 60)]));
    expect(l.prime.pool).toEqual({ r0: OUTER0, r1: expect.closeTo(OUTER0 + BAND) });
    expect(l.prime.kept).toEqual({ r0: expect.closeTo(OUTER0 + BAND * 0.6), r1: expect.closeTo(OUTER0 + BAND), loss: false });
    expect(l.sky.toSky).toEqual({ r0: OUTER0, r1: expect.closeTo(OUTER0 + BAND * 0.6) });
  });

  it("marks a cost of funds larger than the pool as a shortfall in the Prime node", () => {
    const l = layoutSettlementArc(model([venue("A", 70, 100)]));
    expect(l.prime.kept).toEqual({ r0: expect.closeTo(OUTER0 + BAND * 0.7), r1: expect.closeTo(OUTER0 + BAND), loss: true });
    expect(l.prime.pool!.r1).toBeCloseTo(OUTER0 + BAND);
  });

  it("runs SDE innermost, past the Prime through the gap in its node, and meets cost of funds at Sky", () => {
    const l = layoutSettlementArc(model([venue("A", 100, 50), venue("J", 0, 0, 50)]));
    const s = l.sde[0];
    expect(s.r - s.w / 2).toBeCloseTo(OUTER0);
    expect(l.prime.pool!.r0).toBeCloseTo(s.r + s.w / 2);
    expect(arc(s.d).to[0]).toBeGreaterThan(CX + 100);
    // Sky's to-Sky piece is SDE + cost of funds with no gap: the amount due.
    expect(l.sky.toSky!.r1 - l.sky.toSky!.r0).toBeCloseTo((BAND * 100) / 150);
  });

  it("runs the demand side clockwise from Sky round the bottom up into the Prime", () => {
    const l = layoutSettlementArc(model([], [{ key: "gar", label: "GAR", value: 5 }, { key: "agentRate", label: "Agent rate", value: 5 }]));
    expect(l.revenue).toEqual([]);
    expect(l.cof).toBeNull();
    expect(l.demand.map((b) => b.key)).toEqual(["agentRate", "gar"]);
    const a = arc(l.demand[0].d);
    expect(a.sweep).toBe(1);
    expect(a.from[1]).toBeGreaterThan(CY);
    expect(a.from[0]).toBeGreaterThan(CX);
    // Three quarters of the circle: the large-arc flag is set.
    expect(l.demand[0].d).toMatch(/ 0 1 1 /);
    const tip = l.lanes.demand!.head!.split(" L")[1].split(",").map(Number);
    // The tip stops short of the node, leaving clear space.
    expect(CX - tip[0]).toBeCloseTo(PRIME_HALF + ARRIVE_GAP, 0);
    expect(l.prime.demand!.r1 - l.prime.demand!.r0).toBeCloseTo(BAND);
    expect(l.sky.fromSky).toEqual(l.prime.demand);
    expect(layoutSettlementArc(model([])).prime).toEqual({ pool: null, kept: null, demand: null });
  });

  it("starts each venue band further up the arch than the one inside it", () => {
    const l = layoutSettlementArc(model([venue("A", 1000, 900), venue("B", 1, 1), venue("C", 0, 0, 5)]));
    const [c, a, b] = [...l.sde, ...l.revenue].map((v) => arc(v.d).from);
    expect(c[1]).toBeCloseTo(CY, 0);
    expect(a[1]).toBeLessThan(c[1] - 10);
    expect(b[1]).toBeLessThan(a[1] - 10);
    expect(l.revenue[1].w).toBeGreaterThanOrEqual(6);
  });
});
