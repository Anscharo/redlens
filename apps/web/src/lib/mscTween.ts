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
 *  same pairing the flow chart's tween uses. Output order is `to`'s. A
 *  pair with a zero twin carries `alpha`: how far in the row is at k (an
 *  entering row k, a leaving one 1 − k). */
function pair<T>(
  from: readonly T[],
  to: readonly T[],
  key: (x: T) => string,
  zero: (x: T) => T,
  k: number,
): { a: T; b: T; alpha?: number }[] {
  const byKey = new Map(from.map((x) => [key(x), x]));
  const seen = new Set<string>();
  const out: { a: T; b: T; alpha?: number }[] = to.map((b) => {
    seen.add(key(b));
    const a = byKey.get(key(b));
    return a ? { a, b } : { a: zero(b), b, alpha: k };
  });
  for (const a of from) if (!seen.has(key(a))) out.push({ a, b: zero(a), alpha: 1 - k });
  return out;
}

const zeroFlow = (f: PrimeFlowTotals): PrimeFlowTotals => ({ ...f, sky: 0, kept: 0, demand: 0, cof: 0, sde: 0, demandParts: {} });

/** A Prime only one month has grows in from (or shrinks away to) nothing:
 *  its figures tween from zero AND its `alpha` tells the orbit layout to
 *  give it only that fraction of a pie's room, so the other pies drift
 *  over as it arrives rather than jumping to make a slot for it. */
export function tweenPrimeFlows(from: readonly PrimeFlowTotals[], to: readonly PrimeFlowTotals[], k: number): PrimeFlowTotals[] {
  if (k <= 0) return [...from];
  if (k >= 1) return [...to];
  return pair(from, to, (f) => f.prime, zeroFlow, k).map(({ a, b, alpha }) => {
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
      ...(alpha !== undefined ? { alpha } : {}),
    };
  });
}

const zeroVenue = (v: SettlementVenue): SettlementVenue => ({ ...v, revenueToPrime: 0, cofAlloc: 0, profitToSky: 0, profitToGrove: 0, valueEom: 0 });

export function tweenVenues(from: readonly SettlementVenue[], to: readonly SettlementVenue[], k: number): SettlementVenue[] {
  if (k <= 0) return [...from];
  if (k >= 1) return [...to];
  return pair(from, to, (v) => v.id, zeroVenue, k).map(({ a, b }) => ({
    ...b,
    revenueToPrime: mix(a.revenueToPrime, b.revenueToPrime, k),
    cofAlloc: mix(a.cofAlloc, b.cofAlloc, k),
    profitToSky: mix(a.profitToSky, b.profitToSky, k),
    profitToGrove: mix(a.profitToGrove, b.profitToGrove, k),
    valueEom: mix(a.valueEom ?? 0, b.valueEom ?? 0, k),
  }));
}
