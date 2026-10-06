import { describe, expect, it } from "vitest";
import type { StreamModel, VenueStream } from "@/lib/settlementStreams";
import { ARC_OTHER_ID, ARC_TOP_N, BAND, CX, CY, PRIME_R, PRIME_RC, arcVenues, layoutSettlementArc } from "./settlementArcLayout";

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
    // Kept ends at the apex, under the Prime circle.
    expect(kept.to[0]).toBeCloseTo(CX, 1);
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

  it("stacks the demand side inward from the circle and points its one arrow into it", () => {
    const l = layoutSettlementArc(model([venue("A", 100, 90)], [{ key: "agentRate", label: "Agent rate", value: 5 }]));
    const b = l.demand[0];
    // The demand lane's outer edge touches the circle, however thin the lane.
    expect(b.r + b.w / 2).toBeCloseTo(PRIME_RC - PRIME_R + 4);
    // The arrowhead's tip (its second point) lands on the circle.
    const tip = l.inner!.head.split(" L")[1].split(",").map(Number);
    expect(Math.hypot(tip[0] - CX, tip[1] - (CY - PRIME_RC))).toBeLessThan(PRIME_R + 2);
  });

  it("draws a supply-side loss as one hatched kept band", () => {
    const l = layoutSettlementArc(model([venue("A", 50, 100)]));
    expect(l.kept).toMatchObject({ value: -50, loss: true });
    expect(l.venues[0].loss).toBe(false);
  });
});
