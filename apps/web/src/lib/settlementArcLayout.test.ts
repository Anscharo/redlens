import { describe, expect, it } from "vitest";
import type { StreamModel, VenueStream } from "@/lib/settlementStreams";
import { BAND, CX, CY, layoutSettlementArc } from "./settlementArcLayout";

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

describe("layoutSettlementArc", () => {
  it("keeps each venue's stripes together, inside out: kept, cost of funds, SDE", () => {
    const l = layoutSettlementArc(model([venue("A", 100, 40, 20), venue("B", 60, 20)]));
    expect(l.stripes.map((s) => s.key)).toEqual(["A:kept", "A:cof", "A:sde", "B:kept", "B:cof"]);
    const r = l.stripes.map((s) => s.r);
    expect([...r].sort((x, y) => x - y)).toEqual(r);
    expect(l.venueLabels.map((v) => v.venue)).toEqual(["A", "B"]);
  });

  it("sizes stripes and demand bands on one scale", () => {
    const l = layoutSettlementArc(model([venue("A", 100, 50)], [{ key: "agentRate", label: "Agent rate", value: 50 }]));
    expect(l.stripes.map((s) => s.w)).toEqual([BAND / 2, BAND / 2]);
    expect(l.demand[0].w).toBe(BAND / 2);
  });

  it("stops kept at the Prime and carries cost of funds and SDE through to Sky", () => {
    const l = layoutSettlementArc(model([venue("A", 100, 40, 20)]));
    const [kept, cof, sde] = l.stripes.map((s) => ({ ...arc(s.d), head: s.head }));
    for (const s of [kept, cof, sde]) {
      expect(s.sweep).toBe(1);
      expect(s.from[0]).toBeLessThan(CX);
    }
    // Kept ends at the apex, just left of centre; the others reach the right foot.
    expect(kept.to[0]).toBeLessThan(CX);
    expect(kept.to[0]).toBeGreaterThan(CX - 10);
    expect(kept.head).toBeNull();
    for (const s of [cof, sde]) {
      expect(s.to[0]).toBeGreaterThan(CX);
      expect(Math.abs(s.to[1] - CY)).toBeLessThan(15);
      expect(s.head).toMatch(/Z$/);
    }
  });

  it("runs the demand side counterclockwise from Sky's foot up to the Prime", () => {
    const l = layoutSettlementArc(model([], [{ key: "gar", label: "GAR", value: 5 }, { key: "agentRate", label: "Agent rate", value: 5 }]));
    expect(l.stripes).toEqual([]);
    expect(l.demand.map((b) => b.key)).toEqual(["agentRate", "gar"]);
    const a = arc(l.demand[0].d);
    expect(a.sweep).toBe(0);
    expect(a.from[0]).toBeGreaterThan(CX);
    expect(a.from[1]).toBeCloseTo(CY, 0);
    expect(a.to[1]).toBeLessThan(CY - 50);
  });

  it("flags a negative stripe as a loss and sizes it by magnitude", () => {
    const l = layoutSettlementArc(model([venue("A", 50, 100)]));
    expect(l.stripes[0]).toMatchObject({ part: "kept", value: -50, loss: true, w: BAND / 3 });
    expect(l.stripes[1].loss).toBe(false);
  });
});
