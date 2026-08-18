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
}

export interface SettlementHeadline {
  primeAgentRevenue: number;
  skyRevenue: number;
  profitToGrove: number;
  cof: number;
  sdeRevenue: number;
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
