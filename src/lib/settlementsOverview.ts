// Cross-prime MSC aggregation for the /radar index overview. Typed, shared
// (`@/lib`) formalization of the basis the server's msc-views aggregate uses;
// the invariants come from .claude/skills/settlement-reports/SKILL.md:
// supply kept is prime_agent_revenue − cof per prime THEN summed (never
// Σ per-venue profitToGrove), and cof + sde = skyRevenue (components of
// "To Sky", never peer flows).

import {
  DEMAND_SERIES,
  SETTLEMENT_NEAR_ZERO,
  demandPart,
  demandSideRevenue,
  settlementPrimeKeys,
  supplyKept,
  type DemandKey,
  type HeadlineFigure,
  type SettlementsBundle,
  type ThreeWayMonth,
} from "./settlements";

/** The one display order for Primes everywhere the overview shows them —
 *  ring position, timeseries layers, legend, identity colors — so a Prime
 *  keeps its place and color from month to month. It is the Atlas's own
 *  order: the Prime Agent Core docs under A.6.1.1, by doc number (Spark
 *  A.6.1.1.1 … Launch Agent 7 A.6.1.1.8 at the time of writing; doc_nos are
 *  editorial and NOT looked up here — the workbook keys are). Unknown keys
 *  follow, alphabetically. */
export const PRIME_ORDER = [
  "spark", // A.6.1.1.1
  "grove", // A.6.1.1.2
  "keel", // A.6.1.1.3
  "skybase", // A.6.1.1.4
  "obex", // A.6.1.1.5
  "pattern", // A.6.1.1.6
  "osero", // A.6.1.1.7
  "launch-agent-7", // A.6.1.1.8
] as const;

export function primeOrderIndex(prime: string): number {
  const i = (PRIME_ORDER as readonly string[]).indexOf(prime.toLowerCase());
  return i === -1 ? PRIME_ORDER.length : i;
}

export function comparePrimes(a: string, b: string): number {
  return primeOrderIndex(a) - primeOrderIndex(b) || a.localeCompare(b);
}

/** Sorted unique months across all primes (the matrix is ragged — a month
 *  can exist for one prime only, e.g. osero's single 2026-07). */
export function settlementMonths(bundle: SettlementsBundle): string[] {
  return [...new Set(bundle.reports.map((r) => r.month))].sort();
}

export function latestSettlementMonth(bundle: SettlementsBundle): string | null {
  const months = settlementMonths(bundle);
  return months[months.length - 1] ?? null;
}

/** One prime's flow totals for one month, plus what the ring's hover text
 *  and click-through need. */
export interface PrimeFlowTotals {
  /** Workbook prime key, e.g. "spark" — not necessarily a radar slug. */
  prime: string;
  month: string;
  sky: number;
  /** supplyKept(): par − cof. Never Σ venue profitToGrove. */
  kept: number;
  demand: number;
  /** Component of `sky` (hover only — cof + sde = sky). */
  cof: number;
  sde: number;
  /** Non-near-zero demand-side parts, hover only. */
  demandParts: Partial<Record<DemandKey, number>>;
  /** THIS prime's own latest published month — the click-through omits
   *  `?msc` when it equals the selected month, so a prime whose only month
   *  is older than the ecosystem's latest still gets a clean link. */
  latestMonth: string;
}

/** All primes that published a workbook for `month`, in PRIME_ORDER — the
 *  ring lays them out in this order. */
export function primeFlowsForMonth(bundle: SettlementsBundle, month: string): PrimeFlowTotals[] {
  const latestByPrime = new Map<string, string>();
  for (const r of bundle.reports) {
    const prev = latestByPrime.get(r.prime);
    if (!prev || r.month > prev) latestByPrime.set(r.prime, r.month);
  }
  return bundle.reports
    .filter((r) => r.month === month)
    .map((r) => {
      const demandParts: Partial<Record<DemandKey, number>> = {};
      for (const s of DEMAND_SERIES) {
        const v = demandPart(r.headline, s.key);
        if (Math.abs(v) >= SETTLEMENT_NEAR_ZERO) demandParts[s.key] = v;
      }
      return {
        prime: r.prime,
        month: r.month,
        sky: r.headline.skyRevenue,
        kept: supplyKept(r),
        demand: demandSideRevenue(r.headline),
        cof: r.headline.cof,
        sde: r.headline.sdeRevenue,
        demandParts,
        latestMonth: latestByPrime.get(r.prime)!,
      };
    })
    .sort((a, b) => comparePrimes(a.prime, b.prime));
}

export interface EcosystemThreeWay {
  month: string;
  sky: number;
  kept: number;
  demand: number;
  cof: number;
  sde: number;
  /** (sky + kept + demand) − (par + demand + sde). ≈ 0 by identity on every
   *  published workbook; kept as a regression tripwire (mirrors the server
   *  aggregate's foot_delta). */
  footDelta: number;
}

export function ecosystemThreeWay(bundle: SettlementsBundle, month: string): EcosystemThreeWay {
  const reports = bundle.reports.filter((r) => r.month === month);
  const eco = { month, sky: 0, kept: 0, demand: 0, cof: 0, sde: 0 };
  let par = 0;
  for (const r of reports) {
    eco.sky += r.headline.skyRevenue;
    eco.kept += supplyKept(r);
    eco.demand += demandSideRevenue(r.headline);
    eco.cof += r.headline.cof;
    eco.sde += r.headline.sdeRevenue;
    par += r.headline.primeAgentRevenue;
  }
  const footDelta = eco.sky + eco.kept + eco.demand - (par + eco.demand + eco.sde);
  return { ...eco, footDelta };
}

/** Ecosystem three-way per month — feeds SettlementBars as the overview's
 *  month selector. */
export function ecosystemMonths(bundle: SettlementsBundle): ThreeWayMonth[] {
  return settlementMonths(bundle).map((month) => {
    const { sky, kept, demand } = ecosystemThreeWay(bundle, month);
    return { month, sky, kept, demand };
  });
}

/** Same shape and reasoning as headlineFigures(): cost of funds and Sky
 *  Direct Exposure render as components of "To Sky", never peers — a peer
 *  row invites adding them and counting Sky's take twice. */
export function ecosystemHeadlineFigures(eco: EcosystemThreeWay): HeadlineFigure[] {
  const rows: HeadlineFigure[] = [{ label: "To Sky", value: eco.sky }];
  if (Math.abs(eco.cof) >= SETTLEMENT_NEAR_ZERO) {
    rows.push({ label: "of which cost of funds", value: eco.cof, component: true });
  }
  if (Math.abs(eco.sde) >= SETTLEMENT_NEAR_ZERO) {
    rows.push({ label: "of which Sky Direct Exposure", value: eco.sde, component: true });
  }
  rows.push(
    { label: "Supply kept by Primes", value: eco.kept },
    // "to Primes": the demand parts (agent rate, DR, GAR, chronicle) are
    // prime-side addends in the workbook Summary — revenue flowing TO the
    // Prime from demand-side activity, not payouts by it.
    { label: "Demand-side to Primes", value: eco.demand },
  );
  return rows;
}

export interface PrimeStackMonth {
  month: string;
  /** Σ skyRevenue for the month — the overlaid line, disjoint from the stack. */
  sky: number;
  /** Per-prime supply kept + demand-side, in the stable stacking order. */
  parts: Array<{ prime: string; value: number }>;
  /** Per-prime To-Sky (skyRevenue), same order — the second stack, which
   *  sums to `sky` exactly. */
  skyParts: Array<{ prime: string; value: number }>;
}

/**
 * Monthly stack for the overview timeseries: each prime's layer is
 * `supplyKept + demandSideRevenue` — the prime-side value that did NOT go to
 * Sky — so the stack and the `sky` line never share a dollar
 * (par + demand = kept + demand + cof, and sky = cof + sde). Never Σ venue
 * profitToGrove, and never gross primeAgentRevenue (that would put CoF in
 * both the stack and the line).
 *
 * Prime order is PRIME_ORDER (the overview's one display order), returned
 * as `primes` so the chart keys its colors off the same roster.
 * Ragged primes simply contribute no part in months they didn't publish.
 * Negative values are preserved signed (stacked below the zero line).
 */
export function primeStackMonths(bundle: SettlementsBundle): {
  primes: string[];
  months: PrimeStackMonth[];
} {
  const valueOf = new Map<string, number>();
  const skyOf = new Map<string, number>();
  for (const r of bundle.reports) {
    valueOf.set(`${r.prime}::${r.month}`, supplyKept(r) + demandSideRevenue(r.headline));
    skyOf.set(`${r.prime}::${r.month}`, r.headline.skyRevenue);
  }
  const order = [...new Set(bundle.reports.map((r) => r.prime))].sort(comparePrimes);
  const months = settlementMonths(bundle).map((month) => {
    const reports = bundle.reports.filter((r) => r.month === month);
    const sky = reports.reduce((n, r) => n + r.headline.skyRevenue, 0);
    const present = new Set(reports.map((r) => r.prime));
    const parts = order
      .filter((p) => present.has(p))
      .map((prime) => ({ prime, value: valueOf.get(`${prime}::${month}`)! }))
      .filter((p) => Math.abs(p.value) >= SETTLEMENT_NEAR_ZERO);
    const skyParts = order
      .filter((p) => present.has(p))
      .map((prime) => ({ prime, value: skyOf.get(`${prime}::${month}`)! }))
      .filter((p) => Math.abs(p.value) >= SETTLEMENT_NEAR_ZERO);
    return { month, sky, parts, skyParts };
  });
  return { primes: order, months };
}

export interface OverviewActor {
  slug: string;
  name: string;
}

/**
 * Inverse of settlementPrimeKeys: workbook prime key → radar actor.
 *
 * Scans the live actor roster (never a hardcoded prime list — primes are
 * added upstream as Soter publishes them) for an actor whose
 * settlementPrimeKeys contain the key; an exact slug match beats the
 * `<key>-party` composite match. Null means Soter published a prime the
 * atlas has no actor for yet — the wedge renders unlinked, which is
 * correct-by-default, not a bug to fix with a map.
 */
export function actorForPrimeKey(key: string, actors: readonly OverviewActor[]): OverviewActor | null {
  const k = key.trim().toLowerCase();
  if (!k) return null;
  let party: OverviewActor | null = null;
  for (const a of actors) {
    const slug = a.slug.trim().toLowerCase();
    if (slug === k) return a;
    if (!party && settlementPrimeKeys(slug).includes(k)) party = a;
  }
  return party;
}
