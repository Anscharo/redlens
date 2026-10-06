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

/** Layout tests work in millions, above the FULL_SCALE_USD floor, so
 *  the larger lane fills BAND. */
const M = 1_000_000;
const mv = (id: string, revenue: number, cof: number, sde = 0) => venue(id, revenue * M, cof * M, sde * M);

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
    const l = layoutSettlementArc(model([mv("A", 100, 60), mv("B", 20, 0)]));
    for (const v of l.revenue) {
      const a = arc(v.d);
      expect(a.sweep).toBe(1);
      expect(a.to[0]).toBeLessThan(CX - PRIME_HALF);
    }
    expect(l.lanes.revenue?.head).toMatch(/Z$/);
    // Only A has a cost of funds; it leaves the Prime's right side in A's own band.
    expect(l.cof.map((b) => [b.key, b.venue])).toEqual([["A::cof", "A"]]);
    const cof = arc(l.cof[0].d);
    expect(cof.from[0] - CX).toBeCloseTo(PRIME_HALF, 0);
    expect(cof.to[1]).toBeGreaterThan(CY - 60);
    // One scale: revenue 120 fills BAND, A's cost of funds is half of it.
    expect(l.cof[0].w).toBeCloseTo(BAND / 2);
  });

  it("sends an idle venue's cost of funds to Sky though it has no revenue band", () => {
    const l = layoutSettlementArc(model([mv("A", 100, 50), mv("IDLE", 0, 30)]));
    expect(l.revenue.map((b) => b.venue)).toEqual(["A"]);
    expect(l.cof.map((b) => b.venue)).toEqual(["A", "IDLE"]);
    // 100 arrives, 80 leaves: 20 is kept.
    expect(l.prime.kept!.r1 - l.prime.kept!.r0).toBeCloseTo(BAND * 0.2);
  });

  it("sizes the Prime node to the pool and fills the part no band leaves as kept", () => {
    const l = layoutSettlementArc(model([mv("A", 100, 60)]));
    expect(l.prime.span).toEqual({ r0: OUTER0, r1: expect.closeTo(OUTER0 + BAND) });
    expect(l.prime.kept).toEqual({ r0: expect.closeTo(OUTER0 + BAND * 0.6), r1: expect.closeTo(OUTER0 + BAND), loss: false });
    expect(l.sky).toEqual({ r0: OUTER0, r1: expect.closeTo(OUTER0 + BAND * 0.6) });
  });

  it("marks a cost of funds larger than the pool as a shortfall in the Prime node", () => {
    const l = layoutSettlementArc(model([mv("A", 70, 100)]));
    expect(l.prime.kept).toEqual({ r0: expect.closeTo(OUTER0 + BAND * 0.7), r1: expect.closeTo(OUTER0 + BAND), loss: true });
    expect(l.prime.span!.r1).toBeCloseTo(OUTER0 + BAND);
  });

  it("runs SDE innermost, past the Prime through the gap in its node, and meets cost of funds at Sky", () => {
    const l = layoutSettlementArc(model([mv("A", 100, 50), mv("J", 0, 0, 50)]));
    const s = l.sde[0];
    expect(s.r - s.w / 2).toBeCloseTo(OUTER0);
    expect(l.prime.span!.r0).toBeCloseTo(s.r + s.w / 2);
    expect(arc(s.d).to[0]).toBeGreaterThan(CX + 100);
    // At Sky, SDE + cost of funds meet with no gap: the amount due.
    expect(l.sky!.r1 - l.sky!.r0).toBeCloseTo((BAND * 100) / 150);
  });

  it("runs the demand side clockwise from Sky round the bottom up into the Prime", () => {
    const l = layoutSettlementArc(model([], [{ key: "gar", label: "GAR", value: 5 * M }, { key: "agentRate", label: "Agent rate", value: 5 * M }]));
    expect(l.revenue).toEqual([]);
    expect(l.cof).toEqual([]);
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
    expect(l.prime.span!.r1 - l.prime.span!.r0).toBeCloseTo(BAND);
    expect(l.sky).toEqual(l.prime.span);
    expect(layoutSettlementArc(model([])).prime).toEqual({ span: null, kept: null });
  });

  it("draws a small month thin rather than stretching it to fill BAND", () => {
    const l = layoutSettlementArc(model([], [{ key: "agentRate", label: "Agent rate", value: 31_000 }]));
    expect(l.demand[0].w).toBeLessThan(2);
    expect(l.sky!.r1 - l.sky!.r0).toBeLessThan(2);
  });

  it("gives every arrowhead the same tip angle and no overhang", () => {
    const l = layoutSettlementArc(model([mv("A", 100, 60)], [{ key: "agentRate", label: "Agent rate", value: 20 * M }]));
    const base = (head: string) => {
      const [a, , c] = head.slice(1, -2).split(/ L/).map((p) => p.split(",").map(Number));
      return Math.hypot(a[0] - c[0], a[1] - c[1]);
    };
    expect(base(l.lanes.toSky!.head!)).toBeCloseTo(l.lanes.toSky!.w, 0);
    expect(base(l.lanes.demand!.head!)).toBeCloseTo(l.lanes.demand!.w, 0);
  });

  it("never draws an arrowhead narrower than 16px: a thin lane's head overhangs it evenly", () => {
    const l = layoutSettlementArc(model([mv("A", 100, 60)], [{ key: "agentRate", label: "Agent rate", value: 0.5 * M }]));
    const [a, , c] = l.lanes.demand!.head!.slice(1, -2).split(/ L/).map((p) => p.split(",").map(Number));
    expect(l.lanes.demand!.w).toBeLessThan(16);
    expect(Math.hypot(a[0] - c[0], a[1] - c[1])).toBeCloseTo(16, 0);
  });

  it("names each demand series round the bottom-left, outside the lane, with a leader from its band", () => {
    const l = layoutSettlementArc(model([], [{ key: "agentRate", label: "Agent rate", value: 5 * M }, { key: "gar", label: "GAR", value: 3 * M }]));
    expect(l.demandLabels.map((d) => d.key)).toEqual(["agentRate", "gar"]);
    for (const d of l.demandLabels) {
      expect(d.x).toBeLessThan(CX);
      expect(d.y).toBeGreaterThan(CY);
      expect(Math.hypot(d.x - CX, d.y - CY)).toBeGreaterThan(160);
      expect(d.leader).toMatch(/^M[\d.]+,[\d.]+ L[\d.]+,[\d.]+$/);
    }
    // Each further round than the last, so they never stack on one another.
    expect(l.demandLabels[1].y).toBeLessThan(l.demandLabels[0].y);
  });

  it("starts each venue band further up the arch than the one inside it", () => {
    const l = layoutSettlementArc(model([mv("A", 1000, 900), mv("B", 1, 1), mv("C", 0, 0, 5)]));
    const [c, a, b] = [...l.sde, ...l.revenue].map((v) => arc(v.d).from);
    expect(c[1]).toBeCloseTo(CY, 0);
    expect(a[1]).toBeLessThan(c[1] - 10);
    expect(b[1]).toBeLessThan(a[1] - 10);
    expect(l.revenue[1].w).toBeGreaterThanOrEqual(6);
  });
});
