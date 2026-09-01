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

/** All primes that published a workbook for `month`, sorted by magnitude
 *  descending (|sky|+|kept|+|demand|) so the ring's wedge order is stable. */
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
    .sort(
      (a, b) =>
        Math.abs(b.sky) + Math.abs(b.kept) + Math.abs(b.demand) -
        (Math.abs(a.sky) + Math.abs(a.kept) + Math.abs(a.demand)),
    );
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
    { label: "Supply kept", value: eco.kept },
    { label: "Demand-side", value: eco.demand },
  );
  return rows;
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
