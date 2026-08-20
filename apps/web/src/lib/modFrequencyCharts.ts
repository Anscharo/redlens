// Chart-bucket builders for the Modification Frequency report — split out of
// modFrequencyIndex.ts (which keeps the row/group/CSV logic) to stay under
// the ~150-line-per-file convention. Both charts are supplementary views
// ("how are edits distributed/when did they happen"), independent of the
// report's rare/frequent doc-level filter.
import type { ModTimelineCommitRow, ModTimelinePeriodRow } from "@/lib/history";
import type { ModFrequencyRow } from "./modFrequencyIndex";

export interface ModCountBucket {
  /** Exact modification count this bucket represents (the cap value for the
   *  tail bucket — see isTail). */
  count: number;
  /** "0", "1", …, or "20+" for the tail bucket. */
  label: string;
  docs: number;
  /** True for the final bucket when it aggregates every count >= the cap. */
  isTail?: boolean;
}

// Distinct-count bars beyond this collapse into one "N+" tail bucket — a
// handful of heavily-revised docs would otherwise stretch the x-axis to the
// point every other bar reads as zero.
const HISTOGRAM_CAP = 20;

/** One bucket per distinct modification count (0, 1, 2, …), tail-capped, for
 *  the report's distribution chart. Built from the full row set so the chart
 *  reflects every doc regardless of the doc-level filter below it. */
export function buildModCountHistogram(rows: readonly ModFrequencyRow[]): ModCountBucket[] {
  if (rows.length === 0) return [];
  const max = Math.max(...rows.map((r) => r.count));
  const cap = Math.min(max, HISTOGRAM_CAP);
  const docsByCount = new Array<number>(cap + 1).fill(0);
  for (const r of rows) docsByCount[Math.min(r.count, cap)]++;
  return docsByCount.map((docs, count) => ({
    count,
    label: count === cap && max > cap ? `${cap}+` : String(count),
    docs,
    isTail: count === cap && max > cap,
  }));
}

export interface ModTimelineBucket {
  /** "YYYY-MM" (month), "YYYY-MM-DD" (week start), or the commit seq as a
   *  string (commit) — unique per bucket, granularity-dependent. */
  key: string;
  /** Compact axis label — e.g. "Jan '24", "Jan 5 '24", or a short sha. */
  label: string;
  count: number;
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthLabel(year: number, month: number): string {
  return `${MONTH_ABBR[month - 1]} '${String(year).padStart(4, "0").slice(2)}`;
}

function nextMonthKey(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
}

function weekLabel(d: Date): string {
  return `${MONTH_ABBR[d.getUTCMonth()]} ${d.getUTCDate()} '${String(d.getUTCFullYear()).slice(2)}`;
}

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

function nextWeekKey(key: string): string {
  return new Date(new Date(`${key}T00:00:00Z`).getTime() + MS_PER_WEEK).toISOString().slice(0, 10);
}

/** Shared by the month/week builders below: one bucket per period key from the
 *  earliest to the latest seen, zero-filling any period in between with no
 *  edits — a gap in the timeline should read as "no edits that period", not
 *  vanish. `next` steps from one period key to the next (calendar month
 *  arithmetic, or a fixed week-length jump); commit buckets have no periods to
 *  step between, so they're built separately (no zero-fill). */
function zeroFillPeriodBuckets(
  countByPeriod: Map<string, number>,
  next: (key: string) => string,
  labelOf: (key: string) => string,
): ModTimelineBucket[] {
  const periods = [...countByPeriod.keys()].sort();
  if (periods.length === 0) return [];
  const end = periods[periods.length - 1];
  const buckets: ModTimelineBucket[] = [];
  for (let key = periods[0]; ; key = next(key)) {
    buckets.push({ key, label: labelOf(key), count: countByPeriod.get(key) ?? 0 });
    if (key === end) break;
  }
  return buckets;
}

/** One bucket per calendar month from the earliest to the latest month with a
 *  recorded semantic edit, zero-filling any month in between with no edits. */
export function buildModTimelineMonthBuckets(rows: readonly ModTimelinePeriodRow[]): ModTimelineBucket[] {
  const countByMonth = new Map(rows.map((r) => [r.period, r.count]));
  return zeroFillPeriodBuckets(countByMonth, nextMonthKey, (key) => {
    const [year, month] = key.split("-").map(Number);
    return monthLabel(year, month);
  });
}

/** One bucket per ISO week (Monday start, matching Postgres's date_trunc)
 *  from the earliest to the latest week with a recorded semantic edit,
 *  zero-filling any week in between with no edits. */
export function buildModTimelineWeekBuckets(rows: readonly ModTimelinePeriodRow[]): ModTimelineBucket[] {
  const countByWeek = new Map(rows.map((r) => [r.period, r.count]));
  return zeroFillPeriodBuckets(countByWeek, nextWeekKey, (key) => weekLabel(new Date(`${key}T00:00:00Z`)));
}

/** One bucket per commit with a recorded semantic edit, in commit order — no
 *  zero-fill (an absent commit_seq touched no matching content, not a gap in
 *  a continuous axis, so there's nothing to fill). */
export function buildModTimelineCommitBuckets(rows: readonly ModTimelineCommitRow[]): ModTimelineBucket[] {
  return rows.map((r) => ({ key: String(r.seq), label: r.date ?? r.sha.slice(0, 10), count: r.count }));
}
