import { describe, it, expect } from "vitest";
import { layoutStreams, streamPath, PRIME_X, SKY_X, NODE_W, WIDTH } from "./streamLayout";
import type { StreamModel, VenueStream } from "@/lib/settlementStreams";

const venue = (id: string, revenue: number, cof: number, sde = 0): VenueStream => ({ id, label: id, synthetic: false, revenue, sde, cof, kept: revenue - cof });

function model(venues: VenueStream[], demand: StreamModel["demand"] = []): StreamModel {
  const sum = (k: "revenue" | "cof" | "sde" | "kept") => venues.reduce((n, v) => n + v[k], 0);
  return {
    venues,
    revenue: sum("revenue"),
    cof: sum("cof"),
    sde: sum("sde"),
    toSky: sum("cof") + sum("sde"),
    kept: sum("kept"),
    demand,
    demandTotal: demand.reduce((n, d) => n + d.value, 0),
  };
}

/** The x the arrowhead's tip reaches, read off its path. */
const tipX = (head: string) => Number(head.split(" L")[1].split(",")[0]);

describe("streamPath", () => {
  it("puts the arrow tip exactly on the target, pointing either way", () => {
    expect(tipX(streamPath(10, 5, 200, 50, 8).head)).toBe(200);
    expect(tipX(streamPath(200, 5, 10, 50, 8).head)).toBe(10);
  });
});

describe("layoutStreams", () => {
  const m = model([venue("A", 8_000_000, 3_000_000), venue("B", 2_000_000, 1_000_000, 500_000), venue("L", -400_000, 0)], [
    { key: "agentRate", label: "Agent rate", value: 600_000 },
  ]);
  const l = layoutStreams(m);
  const of = (key: string) => l.streams.find((s) => s.key === key)!;

  it("draws widths in proportion to the amounts", () => {
    expect(of("rev-A").w / of("rev-B").w).toBeCloseTo(4);
    expect(of("cof").w / of("demand-agentRate").w).toBeCloseTo(4_000_000 / 600_000);
  });

  it("sends SDE to Sky past the Prime, and the demand side back from Sky", () => {
    expect(tipX(of("sde-B").head)).toBe(SKY_X);
    expect(tipX(of("cof").head)).toBe(SKY_X);
    expect(tipX(of("demand-agentRate").head)).toBe(PRIME_X + NODE_W);
  });

  it("reverses a loss venue's arrow back to the venue", () => {
    expect(of("rev-L").loss).toBe(true);
    expect(tipX(of("rev-L").head)).toBeLessThan(PRIME_X);
  });

  it("keeps the demand lane below the Prime's bar and everything on the canvas", () => {
    expect(l.demand!.y).toBeGreaterThanOrEqual(l.prime.y + l.prime.h);
    expect(l.height).toBeGreaterThanOrEqual(l.demand!.y + l.demand!.h);
    expect(l.width).toBe(WIDTH);
    expect(l.sky.outY).toBe(l.demand!.y);
  });

  it("lays out a demand-only Prime with nothing owed to Sky", () => {
    const d = layoutStreams(model([], [{ key: "agentRate", label: "Agent rate", value: 30_000 }]));
    expect(d.sky.inH).toBe(0);
    expect(d.streams.map((s) => s.kind)).toEqual(["demand"]);
  });
});
