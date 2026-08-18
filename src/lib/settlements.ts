import { fetchJson } from "./verify";

// MSC workbooks from soterlabs/settlement-reports. Independent of the atlas
// SHA, so this is loaded from BASE_URL /settlements.json — not /api/atlas/<sha>/.
// The file is gitignored and baked at Docker image build (or `pnpm settlements:parse`).

export interface SettlementVenue {
  id: string;
  label: string;
  chain: string;
  synthetic: boolean;
  revenueToPrime: number;
  cofAlloc: number;
  profitToSky: number;
  profitToGrove: number;
  /** End-of-month position; parsed from the workbook, 0 when absent. */
  valueEom?: number;
}

export interface SettlementHeadline {
  primeAgentRevenue: number;
  skyRevenue: number;
  profitToGrove: number;
  cof: number;
  sdeRevenue: number;
  /** Demand-side Summary rows. Present on parsed workbooks; optional in tests. */
  agentRate?: number;
  distributionRewards?: number;
  chroniclePoints?: number;
  gar?: number;
  primeAgentTotalRevenue?: number;
}

export interface SettlementReport {
  prime: string;
  month: string;
  settleVersion: string | null;
  generatedAt: string | null;
  period: { start: string; end: string; nDays: number } | null;
  headline: SettlementHeadline;
  venues: SettlementVenue[];
}

export interface SettlementsBundle {
  source: { repo?: string; fetched?: string; dir?: string };
  reports: SettlementReport[];
}

export const EMPTY_SETTLEMENTS: SettlementsBundle = { source: {}, reports: [] };

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

let cached: Promise<SettlementsBundle> | null = null;

export function loadSettlements(): Promise<SettlementsBundle> {
  if (!cached) {
    cached = fetchJson<SettlementsBundle>(
      `${import.meta.env.BASE_URL}settlements.json`,
      "settlements.json",
    ).catch(() => {
      cached = null;
      return EMPTY_SETTLEMENTS;
    });
  }
  return cached;
}

/** Test-only: drop the memoised fetch so the next loadSettlements() hits the network again. */
export function resetSettlementsCache(): void {
  cached = null;
}

/**
 * Which Soter `reports/<prime>/` folders a radar slug should read.
 *
 * Folders are the Prime Agent slug (`spark`). Composite-party pages use
 * the same display name with a `-party` suffix (`spark-party`) and would
 * miss an exact-slug match. Foundations / multisigs (`spark-foundation`)
 * stay unmatched. Pattern and Launch Agent 7 have no published workbooks.
 */
export function settlementPrimeKeys(slug: string): string[] {
  const s = slug.trim().toLowerCase();
  if (!s) return [];
  const keys = [s];
  if (s.endsWith("-party")) keys.push(s.slice(0, -"-party".length));
  return keys;
}

export function reportsForPrime(bundle: SettlementsBundle, slug: string): SettlementReport[] {
  const keys = new Set(settlementPrimeKeys(slug));
  return bundle.reports
    .filter((r) => keys.has(r.prime.toLowerCase()))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export function formatMonth(ym: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return ym;
  return `${MONTH_SHORT[Number(m[2]) - 1]} ${m[1]}`;
}

export function formatUsd(n: number, compact = false): string {
  const sign = n < 0 ? "−" : "";
  const abs = Math.abs(n);
  if (compact) {
    if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
    if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}k`;
  }
  return `${sign}$${abs.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function revenueGap(report: SettlementReport): number {
  const sum = report.venues.reduce((n, v) => n + v.revenueToPrime, 0);
  return Math.abs(sum - report.headline.primeAgentRevenue);
}

/** USD amounts under $1 are treated as empty (rounding dust, not a take). */
const NEAR_ZERO = 1;

/** Agent rate + DR + Chronicle + GAR, falling back to the Summary unlabeled total. */
export function demandSideRevenue(h: SettlementHeadline): number {
  const parts =
    (h.agentRate ?? 0) +
    (h.distributionRewards ?? 0) +
    (h.chroniclePoints ?? 0) +
    (h.gar ?? 0);
  if (Math.abs(parts) >= NEAR_ZERO) return parts;
  return h.primeAgentTotalRevenue ?? 0;
}

export function hasVenuePnl(report: SettlementReport): boolean {
  return report.venues.some(
    (v) => Math.abs(v.profitToSky) + Math.abs(v.profitToGrove) >= NEAR_ZERO,
  );
}

/**
 * Demand-side-only cycle (Keel, Skybase): no venue PnL, Sky's take is ~$0,
 * but the prime-side Summary still has agent rate / rewards.
 */
export function isDemandSideCycle(report: SettlementReport): boolean {
  return (
    !hasVenuePnl(report) &&
    Math.abs(report.headline.skyRevenue) < NEAR_ZERO &&
    Math.abs(demandSideRevenue(report.headline)) >= NEAR_ZERO
  );
}

export function teaserFigure(report: SettlementReport): { amount: number; suffix: string } {
  const sky = report.headline.skyRevenue;
  if (Math.abs(sky) >= NEAR_ZERO) return { amount: sky, suffix: "to Sky" };
  if (isDemandSideCycle(report)) {
    return { amount: demandSideRevenue(report.headline), suffix: "kept" };
  }
  const kept = report.headline.profitToGrove;
  if (Math.abs(kept) >= NEAR_ZERO) return { amount: kept, suffix: "kept" };
  return { amount: sky, suffix: "to Sky" };
}

/** Summary three-way: Sky take, supply-side kept (P2G), demand-side. */
export interface ThreeWayMonth {
  month: string;
  sky: number;
  kept: number;
  demand: number;
}

export function summaryThreeWay(report: SettlementReport): ThreeWayMonth {
  return {
    month: report.month,
    sky: report.headline.skyRevenue,
    kept: report.headline.profitToGrove,
    demand: demandSideRevenue(report.headline),
  };
}

export function threeWayPeaks(months: readonly ThreeWayMonth[]): { peakPos: number; peakNeg: number } {
  let peakPos = 0;
  let peakNeg = 0;
  for (const m of months) {
    for (const v of [m.sky, m.kept, m.demand]) {
      if (v >= 0) peakPos = Math.max(peakPos, v);
      else peakNeg = Math.max(peakNeg, -v);
    }
  }
  return { peakPos: Math.max(peakPos, 1), peakNeg };
}

export function barFillStyle(
  value: number,
  peakPos: number,
  peakNeg: number,
): { bottom: string; height: string } | null {
  const span = Math.max(1, peakPos + peakNeg);
  const zero = (peakNeg / span) * 100;
  const h = (Math.abs(value) / span) * 100;
  if (h < 0.4) return null;
  if (value >= 0) return { bottom: `${zero}%`, height: `${h}%` };
  return { bottom: `${zero - h}%`, height: `${h}%` };
}

export const DEMAND_SERIES = [
  { key: "agentRate", label: "Agent rate", barClass: "msc-bar-rate" },
  { key: "distributionRewards", label: "Distribution rewards", barClass: "msc-bar-dr" },
  { key: "gar", label: "Accessibility rewards", barClass: "msc-bar-gar" },
  { key: "chroniclePoints", label: "Chronicle points", barClass: "msc-bar-chronicle" },
] as const;

export type DemandKey = (typeof DEMAND_SERIES)[number]["key"];

export function demandPart(h: SettlementHeadline, key: DemandKey): number {
  return h[key] ?? 0;
}

export function activeDemandSeries(reports: readonly SettlementReport[]) {
  return DEMAND_SERIES.filter((s) =>
    reports.some((r) => Math.abs(demandPart(r.headline, s.key)) >= NEAR_ZERO),
  );
}

export function venuePnlCount(report: SettlementReport): number {
  return report.venues.filter(
    (v) => Math.abs(v.profitToSky) + Math.abs(v.profitToGrove) >= NEAR_ZERO,
  ).length;
}

export function hasMultiVenuePnl(report: SettlementReport): boolean {
  return venuePnlCount(report) >= 2;
}

export function hasVenueAum(report: SettlementReport): boolean {
  return report.venues.some((v) => Math.abs(v.valueEom ?? 0) >= NEAR_ZERO);
}

export function collapseAum(
  venues: readonly Pick<SettlementVenue, "id" | "label" | "synthetic" | "valueEom">[],
  topN = 12,
  minAbs = 1,
): { id: string; label: string; synthetic: boolean; valueEom: number }[] {
  const kept = venues
    .map((v) => ({
      id: v.id,
      label: v.label || v.id,
      synthetic: v.synthetic,
      valueEom: v.valueEom ?? 0,
    }))
    .filter((v) => Math.abs(v.valueEom) >= minAbs)
    .sort((a, b) => Math.abs(b.valueEom) - Math.abs(a.valueEom));
  if (kept.length <= topN) return kept;
  const head = kept.slice(0, topN);
  const tail = kept.slice(topN);
  return [
    ...head,
    {
      id: "_other",
      label: `Other venues (${tail.length})`,
      synthetic: false,
      valueEom: tail.reduce((n, v) => n + v.valueEom, 0),
    },
  ];
}

export function headlineFigures(report: SettlementReport): { label: string; value: number }[] {
  const rows = [
    { label: "To Sky", value: report.headline.skyRevenue },
    { label: "Supply kept", value: report.headline.profitToGrove },
    { label: "Demand-side", value: demandSideRevenue(report.headline) },
  ];
  if (Math.abs(report.headline.cof) >= NEAR_ZERO) {
    rows.push({ label: "Cost of funds", value: report.headline.cof });
  }
  return rows;
}
