import { describe, expect, it } from "vitest";
import type { StreamModel, VenueStream } from "@/lib/settlementStreams";
import { ARC_OTHER_ID, ARC_TOP_N, BAND, CX, CY, OUTER0, PRIME_HALF, arcVenues, layoutSettlementArc } from "./settlementArcLayout";

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

describe("arcVenues", () => {
  it("draws each venue's cost of funds + SDE, largest first, folding the tail into Other", () => {
    const vs = Array.from({ length: ARC_TOP_N + 3 }, (_, i) => venue(`V${i}`, 100, 10 + i, 1));
    const rows = arcVenues(model(vs));
    expect(rows).toHaveLength(ARC_TOP_N + 1);
    expect(rows[0]).toMatchObject({ key: `V${ARC_TOP_N + 2}`, value: ARC_TOP_N + 13 });
    expect(rows.at(-1)).toMatchObject({ key: ARC_OTHER_ID, value: 11 + 12 + 13 });
  });

  it("drops a venue with nothing going to Sky", () => {
    expect(arcVenues(model([venue("A", 100, 0)]))).toEqual([]);
  });
});

describe("layoutSettlementArc", () => {
  it("puts kept innermost, then the venues, on one scale with the demand side", () => {
    const l = layoutSettlementArc(model([venue("A", 100, 30, 20)], [{ key: "agentRate", label: "Agent rate", value: 50 }]));
    // kept 70 + A 50 = 120 fills BAND.
    expect(l.kept?.w).toBeCloseTo((BAND * 70) / 120);
    expect(l.venues[0].w).toBeCloseTo((BAND * 50) / 120);
    expect(l.demand[0].w).toBeCloseTo((BAND * 50) / 120);
    expect(l.kept!.r).toBeLessThan(l.venues[0].r);
  });

  it("ends kept at the Prime circle and carries the venues through to one arrowhead at Sky", () => {
    const l = layoutSettlementArc(model([venue("A", 100, 40, 20), venue("B", 50, 30)]));
    const kept = arc(l.kept!.d);
    expect(kept.sweep).toBe(1);
    // Kept ends at the Prime bar's left side.
    expect(CX - kept.to[0]).toBeCloseTo(PRIME_HALF, 0);
    for (const v of l.venues) {
      const a = arc(v.d);
      expect(a.sweep).toBe(1);
      expect(a.to[0]).toBeGreaterThan(CX);
    }
    expect(l.outer?.head).toMatch(/Z$/);
    expect(l.outer?.w).toBeCloseTo(l.venues.reduce((n, v) => n + v.w, 0));
  });

  it("runs the demand side counterclockwise from Sky's foot up to the Prime", () => {
    const l = layoutSettlementArc(model([], [{ key: "gar", label: "GAR", value: 5 }, { key: "agentRate", label: "Agent rate", value: 5 }]));
    expect(l.venues).toEqual([]);
    expect(l.kept).toBeNull();
    expect(l.outer).toBeNull();
    expect(l.demand.map((b) => b.key)).toEqual(["agentRate", "gar"]);
    const a = arc(l.demand[0].d);
    expect(a.sweep).toBe(0);
    expect(a.from[1]).toBeCloseTo(CY, 0);
    expect(a.to[1]).toBeLessThan(CY - 50);
  });

  it("spans the Prime bar over exactly the bands drawn, and ends both lanes at its sides", () => {
    const l = layoutSettlementArc(model([venue("A", 100, 90)], [{ key: "agentRate", label: "Agent rate", value: 5 }]));
    const b = l.demand[0];
    const outerEdge = l.venues[0].r + l.venues[0].w / 2;
    expect(l.prime).toEqual({ r0: expect.closeTo(b.r - b.w / 2), r1: expect.closeTo(outerEdge) });
    // The demand lane stays next to the outer lane however thin it is.
    expect(OUTER0 - (b.r + b.w / 2)).toBeLessThan(20);
    // The demand arrow's tip (its second point) lands on the bar's right side.
    const tip = l.inner!.head.split(" L")[1].split(",").map(Number);
    expect(tip[0] - CX).toBeCloseTo(PRIME_HALF, 0);
  });

  it("spans only the drawn lane when the other is empty", () => {
    const l = layoutSettlementArc(model([], [{ key: "agentRate", label: "Agent rate", value: 5 }]));
    expect(l.prime!.r1 - l.prime!.r0).toBeCloseTo(l.demand[0].w);
    expect(layoutSettlementArc(model([])).prime).toBeNull();
  });
  it("starts each venue band further up the arch than the one inside it, with room for its name", () => {
    const l = layoutSettlementArc(model([venue("A", 1000, 900), venue("B", 100, 1)]));
    const [a, b] = l.venues.map((v) => arc(v.d).from);
    // B starts higher (smaller y) than A, which starts at the foot.
    expect(a[1]).toBeCloseTo(CY, 0);
    expect(b[1]).toBeLessThan(a[1] - 10);
    expect(l.venues[1].w).toBeGreaterThanOrEqual(6);
  });
});
