// Month-to-month transitions for the charts that lay themselves out from
// their rows each render — the orbital pies (from PrimeFlowTotals) and a
// Prime's venue Sankey / AUM bars (from SettlementVenue rows). Rather than
// tweening their geometry, these interpolate the INPUT rows and let the
// chart lay out every frame, so each frame is a valid chart: a pie grows
// and its orbit shifts, a ribbon thickens, a bar stretches. A row present
// in only one month tweens from or to its own zero (every figure 0), so it
// grows in or shrinks away at its own place. Row identity: the Prime key;
// the venue id.
import type { SettlementVenue } from "@/lib/settlements";
import type { PrimeFlowTotals } from "@/lib/settlementsOverview";

const mix = (a: number, b: number, k: number) => a + (b - a) * k;

/** Pair `to`'s rows with their `from` twins (or a zero twin), then append
 *  `from`'s rows that `to` lacks, paired with their own zero twin — the
 *  same pairing the flow chart's tween uses. Output order is `to`'s. */
function pair<T>(from: readonly T[], to: readonly T[], key: (x: T) => string, zero: (x: T) => T): [T, T][] {
  const byKey = new Map(from.map((x) => [key(x), x]));
  const seen = new Set<string>();
  const out: [T, T][] = to.map((b) => {
    seen.add(key(b));
    return [byKey.get(key(b)) ?? zero(b), b];
  });
  for (const a of from) if (!seen.has(key(a))) out.push([a, zero(a)]);
  return out;
}

const zeroFlow = (f: PrimeFlowTotals): PrimeFlowTotals => ({ ...f, sky: 0, kept: 0, demand: 0, cof: 0, sde: 0, demandParts: {} });

export function tweenPrimeFlows(from: readonly PrimeFlowTotals[], to: readonly PrimeFlowTotals[], k: number): PrimeFlowTotals[] {
  if (k <= 0) return [...from];
  if (k >= 1) return [...to];
  return pair(from, to, (f) => f.prime, zeroFlow).map(([a, b]) => {
    const keys = new Set([...Object.keys(a.demandParts), ...Object.keys(b.demandParts)] as (keyof PrimeFlowTotals["demandParts"])[]);
    const demandParts: PrimeFlowTotals["demandParts"] = {};
    for (const key of keys) demandParts[key] = mix(a.demandParts[key] ?? 0, b.demandParts[key] ?? 0, k);
    return {
      ...b,
      sky: mix(a.sky, b.sky, k),
      kept: mix(a.kept, b.kept, k),
      demand: mix(a.demand, b.demand, k),
      cof: mix(a.cof, b.cof, k),
      sde: mix(a.sde, b.sde, k),
      demandParts,
    };
  });
}

const zeroVenue = (v: SettlementVenue): SettlementVenue => ({ ...v, revenueToPrime: 0, cofAlloc: 0, profitToSky: 0, profitToGrove: 0, valueEom: 0 });

export function tweenVenues(from: readonly SettlementVenue[], to: readonly SettlementVenue[], k: number): SettlementVenue[] {
  if (k <= 0) return [...from];
  if (k >= 1) return [...to];
  return pair(from, to, (v) => v.id, zeroVenue).map(([a, b]) => ({
    ...b,
    revenueToPrime: mix(a.revenueToPrime, b.revenueToPrime, k),
    cofAlloc: mix(a.cofAlloc, b.cofAlloc, k),
    profitToSky: mix(a.profitToSky, b.profitToSky, k),
    profitToGrove: mix(a.profitToGrove, b.profitToGrove, k),
    valueEom: mix(a.valueEom ?? 0, b.valueEom ?? 0, k),
  }));
}
