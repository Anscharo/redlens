import { describe, it, expect } from "vitest";
import { tweenPrimeFlows, tweenVenues } from "./mscTween";
import type { PrimeFlowTotals } from "@/lib/settlementsOverview";
import type { SettlementVenue } from "@/lib/settlements";

const flow = (over: Partial<PrimeFlowTotals> = {}): PrimeFlowTotals => ({
  prime: "spark", month: "2026-07", sky: 100, kept: 40, demand: 10, cof: 90, sde: 10,
  demandParts: { agentRate: 10 }, latestMonth: "2026-07", ...over,
});
const venue = (over: Partial<SettlementVenue> = {}): SettlementVenue => ({
  id: "v1", label: "Venue 1", chain: "ethereum", synthetic: false,
  revenueToPrime: 100, cofAlloc: 60, profitToSky: 60, profitToGrove: 40, valueEom: 1000, ...over,
});

describe("tweenPrimeFlows", () => {
  it("interpolates every figure of a Prime present both months, and its demand parts", () => {
    const [m] = tweenPrimeFlows([flow()], [flow({ sky: 200, kept: 0, cof: 150, sde: 50, demand: 30, demandParts: { agentRate: 20, gar: 10 } })], 0.5);
    expect(m).toMatchObject({ prime: "spark", sky: 150, kept: 20, demand: 20, cof: 120, sde: 30 });
    expect(m.demandParts).toEqual({ agentRate: 15, gar: 5 });
  });

  it("grows a new Prime from zero and shrinks a leaving one to zero, kept after the rest", () => {
    const june = [flow()];
    const july = [flow(), flow({ prime: "grove", sky: 400 })];
    expect(tweenPrimeFlows(june, july, 0.25).find((f) => f.prime === "grove")!.sky).toBe(100);
    const back = tweenPrimeFlows(july, june, 0.75);
    expect(back.map((f) => f.prime)).toEqual(["spark", "grove"]);
    expect(back[1].sky).toBe(100);
  });

  it("is the endpoints at 0 and 1", () => {
    const a = [flow()];
    const b = [flow({ sky: 5 })];
    expect(tweenPrimeFlows(a, b, 0)).toEqual(a);
    expect(tweenPrimeFlows(a, b, 1)).toEqual(b);
  });
});

describe("tweenVenues", () => {
  it("interpolates a venue's figures by id and zeroes one only the other month has", () => {
    const june = [venue(), venue({ id: "v2", label: "June-only", profitToSky: 20, profitToGrove: 20 })];
    const july = [venue({ profitToSky: 0, profitToGrove: 80, valueEom: 3000 })];
    const mid = tweenVenues(june, july, 0.5);
    expect(mid.map((v) => v.id)).toEqual(["v1", "v2"]);
    expect(mid[0]).toMatchObject({ profitToSky: 30, profitToGrove: 60, valueEom: 2000, label: "Venue 1" });
    expect(mid[1]).toMatchObject({ profitToSky: 10, profitToGrove: 10, label: "June-only" });
    expect(tweenVenues(june, july, 1)).toEqual(july);
  });
});
