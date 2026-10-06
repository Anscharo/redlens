import { describe, expect, it } from "vitest";
import type { StreamModel } from "@/lib/settlementStreams";
import { BAND, CX, CY, layoutSettlementRing } from "./settlementRingLayout";

function model(cof: number, sde: number, demand: StreamModel["demand"] = []): StreamModel {
  const demandTotal = demand.reduce((n, d) => n + d.value, 0);
  return { venues: [], revenue: 0, cof, sde, toSky: cof + sde, kept: 0, demand, demandTotal };
}

/** The point an arc path starts at and the sweep flag it is drawn with. */
function arc(d: string) {
  const [x, y] = d.slice(1).split(" ")[0].split(",").map(Number);
  const sweep = Number(d.split(" A")[1].split(" ")[3]);
  return { x, y, sweep };
}

describe("layoutSettlementRing", () => {
  it("sizes bands by amount on one scale shared by both lanes", () => {
    const l = layoutSettlementRing(model(300, 100, [{ key: "agentRate", label: "Agent rate", value: 200 }]));
    expect(l.outer.map((b) => b.w)).toEqual([BAND * 0.75, BAND * 0.25]);
    expect(l.inner[0].w).toBe(BAND / 2);
    // CoF sits inside SDE on the outer lane.
    expect(l.outer[0].r).toBeLessThan(l.outer[1].r);
  });

  it("runs the outer lane clockwise from Sky's right and the inner lane counterclockwise from Sky's left", () => {
    const l = layoutSettlementRing(model(10, 0, [{ key: "agentRate", label: "Agent rate", value: 10 }]));
    const out = arc(l.outer[0].d);
    const inn = arc(l.inner[0].d);
    expect(out.sweep).toBe(1);
    expect(out.x).toBeGreaterThan(CX);
    expect(out.y).toBeLessThan(CY);
    expect(inn.sweep).toBe(0);
    expect(inn.x).toBeLessThan(CX);
    expect(l.outer[0].head).toMatch(/Z$/);
    expect(l.inward).not.toBeNull();
  });

  it("draws only the inner lane for a demand-only Prime", () => {
    const l = layoutSettlementRing(model(0, 0, [{ key: "gar", label: "GAR", value: 5 }, { key: "agentRate", label: "Agent rate", value: 5 }]));
    expect(l.outer).toEqual([]);
    expect(l.inner.map((b) => b.key)).toEqual(["agentRate", "gar"]);
  });

  it("flags a negative band as a loss and sizes it by magnitude", () => {
    const l = layoutSettlementRing(model(-50, 50));
    expect(l.outer[0]).toMatchObject({ key: "cof", loss: true, w: BAND / 2 });
    expect(l.outer[1].loss).toBe(false);
  });
});
