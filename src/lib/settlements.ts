// MSC workbooks from soterlabs/settlement-reports. Shared by Radar (browser
// fetch) and the server (disk read for chat/MCP views). Independent of the
// atlas SHA.
//
// See .claude/skills/settlement-reports/SKILL.md before changing how any
// figure is derived: supply-side revenue is prime_agent_revenue − cof (NOT
// Σ per-venue profitToGrove), and cost of funds is a component of what goes
// to Sky, not a fourth flow.

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

/**
 * True when `settlements.json` failed to load (404, bake miss), not when a
 * prime simply has no published workbooks. `loadSettlements` swallows the
 * fetch error and returns `EMPTY_SETTLEMENTS`, which is truthy — callers
 * must not treat that as "this slug has no MSC files."
 */
export function settlementsArtifactMissing(bundle: SettlementsBundle): boolean {
  return (
    bundle.reports.length === 0 &&
    bundle.source.repo == null &&
    bundle.source.fetched == null &&
    bundle.source.dir == null
  );
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** USD amounts under $1 are treated as empty (rounding dust, not a take). */
export const SETTLEMENT_NEAR_ZERO = 1;

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

const NEAR_ZERO = SETTLEMENT_NEAR_ZERO;

/**
 * Agent rate + DR + Chronicle + GAR — the Summary's Prime-side addends
 * other than prime_agent_revenue.
 *
 * Deliberately has no fallback to `primeAgentTotalRevenue`: that is the
 * WHOLE prime-side total (supply + demand), already counted by
 * `supplyKept` and `skyRevenue`, so returning it here would double-count
 * the entire cycle. The parser now throws when `+ agent_rate` is missing,
 * so these parts are always readable.
 */
export function demandSideRevenue(h: SettlementHeadline): number {
  return (h.agentRate ?? 0) + (h.distributionRewards ?? 0) + (h.chroniclePoints ?? 0) + (h.gar ?? 0);
}

/**
 * The Prime's supply-side revenue: what it keeps from the venue book after
 * paying Sky.
 *
 * `prime_agent_revenue − cost of funds`, which is how settlement-cycle
 * itself defines it (`src/settle/load/summary.py`) and what its published
 * summary.md prints. Explicitly NOT `headline.profitToGrove` (the
 * Comparison block's Σ per-venue "Profit to Grove"): that sum is built
 * from a pro-rata CoF allocation the pipeline calls "a display choice
 * without a defensible formula", and it silently drops prime-level
 * revenue with no venue row (PSM3 sUSDS appreciation) plus the sUSDS
 * spread reimbursement. On Spark those two omissions ran to ~$1.0M/month.
 */
export function supplyKept(report: SettlementReport): number {
  return report.headline.primeAgentRevenue - report.headline.cof;
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
  const kept = supplyKept(report);
  if (Math.abs(kept) >= NEAR_ZERO) return { amount: kept, suffix: "kept" };
  return { amount: sky, suffix: "to Sky" };
}

// There is deliberately no `grossByMonth` / "gross revenue" helper here any
// more. It summed sky + kept + demand, which adds what a Prime owes Sky to
// what Sky owes the Prime — two settlement amounts running in opposite
// directions (A.2.4.1.2.2.1.1.2 and A.2.4.1.2.2.1.1.1) that the Atlas never
// totals, and "gross revenue" is not an Atlas term. Use `cycleTotals` and
// keep the three apart.

/** The most cycles any settlement chart shows at once: a year. */
export const CYCLE_WINDOW = 12;

/** The window of at most `size` rows (chronological input) ending `offset`
 *  rows before the last one — offset 0 is the trailing year. The window is
 *  always full when there are enough rows, so paging never shows a stub. */
export function cycleWindow<T>(
  rows: readonly T[],
  offset = 0,
  size = CYCLE_WINDOW,
): { rows: T[]; earlier: boolean; later: boolean } {
  const end = rows.length - Math.min(Math.max(0, offset), Math.max(0, rows.length - size));
  const start = Math.max(0, end - size);
  return { rows: rows.slice(start, end), earlier: start > 0, later: end < rows.length };
}

/** The window offset that keeps row `index` on screen: the current offset
 *  when the row is already in its window, else the window that ends on
 *  the row (a selected month is never hidden by paging). */
export function windowOffsetFor(total: number, offset: number, index: number, size = CYCLE_WINDOW): number {
  const max = Math.max(0, total - size);
  const o = Math.min(Math.max(0, offset), max);
  const end = total - o;
  if (index >= end - size && index < end) return o;
  return Math.min(total - 1 - index, max);
}

/** Summary three-way: Sky take, supply-side kept (`par − CoF`), demand-side. */
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
    kept: supplyKept(report),
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

/** The two sides are summed SEPARATELY and never added together. The
 *  Monthly Settlement Cycle settles them as two amounts running in
 *  opposite directions: what a Prime owes Sky for Supply Side Primitives
 *  (A.2.4.1.2.2.1.1.2) and what Sky owes the Prime for Demand Side
 *  Primitives and the Agent Rate (A.2.4.1.2.2.1.1.1). They are settled in
 *  the same vote (A.2.4.1.2.2.1.1.3), but the Atlas defines no term for
 *  their sum — so neither do we. */

/** Supply-side kept (`par − CoF`), summed over the given months. Signed: a
 *  month whose cost of funds outran its revenue is a loss. */
export function supplyKeptTotal(reports: readonly SettlementReport[]): number {
  return reports.reduce((sum, r) => sum + supplyKept(r), 0);
}

/** What the Prime owed Sky, summed over the given months. */
export function skyTotal(reports: readonly SettlementReport[]): number {
  return reports.reduce((sum, r) => sum + r.headline.skyRevenue, 0);
}

/** The three running totals of a window of cycles, kept APART. There is no
 *  fourth field on purpose: adding them would mix what the Prime owes Sky
 *  with what Sky owes the Prime, and the Atlas defines no such total. */
export interface CycleTotals {
  sky: number;
  kept: number;
  demand: number;
}

export function cycleTotals(reports: readonly SettlementReport[]): CycleTotals {
  return { sky: skyTotal(reports), kept: supplyKeptTotal(reports), demand: demandSideTotal(reports) };
}

/** Which total leads the actor page's card: what went to Sky, unless this
 *  Prime sent Sky nothing over the window (Keel and Skybase never do), in
 *  which case the demand side is the only figure it has. */
export function leadCycleTotal(t: CycleTotals): { amount: number; label: string } {
  if (Math.abs(t.sky) >= NEAR_ZERO) return { amount: t.sky, label: "to Sky" };
  if (Math.abs(t.demand) >= NEAR_ZERO) return { amount: t.demand, label: "demand-side from Sky" };
  return { amount: t.kept, label: "supply-side kept" };
}

/** Demand-side (agent rate + rewards) over the given months — what Sky
 *  owes the Prime, not what the Prime kept out of its own revenue. */
export function demandSideTotal(reports: readonly SettlementReport[]): number {
  return reports.reduce((sum, r) => sum + demandSideRevenue(r.headline), 0);
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

export interface HeadlineFigure {
  label: string;
  value: number;
  /** A breakdown of the figure above it, not a flow of its own. */
  component?: boolean;
}

/**
 * The three ways a settled dollar can end up, plus cost of funds shown as
 * what it is: a part of Sky's take, not a fourth destination.
 *
 * Cost of funds IS the money sent to Sky — settlement-cycle derives it as
 * `sky_revenue − sde_revenue`, so the two differ only by Sky Direct
 * Exposure (zero for Obex, <0.5% for Spark, material for Grove). Listing
 * either as a peer of "To Sky" invited readers to add the row and count
 * Sky's take twice. Both render as components so Grove's remainder is
 * labeled rather than looking like a math error.
 */
export function headlineFigures(report: SettlementReport): HeadlineFigure[] {
  const { skyRevenue, cof, sdeRevenue } = report.headline;
  const rows: HeadlineFigure[] = [{ label: "To Sky", value: skyRevenue }];
  if (Math.abs(cof) >= NEAR_ZERO) {
    rows.push({ label: "of which cost of funds", value: cof, component: true });
  }
  if (Math.abs(sdeRevenue) >= NEAR_ZERO) {
    rows.push({ label: "of which Sky Direct Exposure", value: sdeRevenue, component: true });
  }
  rows.push(
    { label: "Supply kept", value: supplyKept(report) },
    { label: "Demand-side", value: demandSideRevenue(report.headline) },
  );
  return rows;
}
