// Chart-bucket builders for the Modification Frequency report — split out of
// modFrequencyIndex.ts (which keeps the row/group/CSV logic) to stay under
// the ~150-line-per-file convention. Both charts are supplementary views
// ("how are edits distributed/when did they happen"), independent of the
// report's rare/frequent doc-level filter.
import type { ModTimelineCommitRow, ModTimelinePeriodRow } from "./history";
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

/** One bucket per calendar month from the earliest to the latest month with a
 *  recorded semantic edit, zero-filling any month in between with no edits —
 *  a gap in the timeline should read as "no edits that month", not vanish. */
export function buildModTimelineMonthBuckets(rows: readonly ModTimelinePeriodRow[]): ModTimelineBucket[] {
  if (rows.length === 0) return [];
  const countByMonth = new Map(rows.map((r) => [r.period, r.count]));
  const months = [...countByMonth.keys()].sort();
  const [startYear, startMonth] = months[0].split("-").map(Number);
  const [endYear, endMonth] = months[months.length - 1].split("-").map(Number);

  const buckets: ModTimelineBucket[] = [];
  let year = startYear;
  let month = startMonth;
  while (year < endYear || (year === endYear && month <= endMonth)) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    buckets.push({ key, label: monthLabel(year, month), count: countByMonth.get(key) ?? 0 });
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }
  return buckets;
}

function weekLabel(d: Date): string {
  return `${MONTH_ABBR[d.getUTCMonth()]} ${d.getUTCDate()} '${String(d.getUTCFullYear()).slice(2)}`;
}

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/** One bucket per ISO week (Monday start, matching Postgres's date_trunc)
 *  from the earliest to the latest week with a recorded semantic edit,
 *  zero-filling any week in between with no edits. */
export function buildModTimelineWeekBuckets(rows: readonly ModTimelinePeriodRow[]): ModTimelineBucket[] {
  if (rows.length === 0) return [];
  const countByWeek = new Map(rows.map((r) => [r.period, r.count]));
  const weeks = [...countByWeek.keys()].sort();
  const start = new Date(`${weeks[0]}T00:00:00Z`).getTime();
  const end = new Date(`${weeks[weeks.length - 1]}T00:00:00Z`).getTime();

  const buckets: ModTimelineBucket[] = [];
  for (let t = start; t <= end; t += MS_PER_WEEK) {
    const d = new Date(t);
    const key = d.toISOString().slice(0, 10);
    buckets.push({ key, label: weekLabel(d), count: countByWeek.get(key) ?? 0 });
  }
  return buckets;
}

/** One bucket per commit with a recorded semantic edit, in commit order — no
 *  zero-fill (an absent commit_seq touched no matching content, not a gap in
 *  a continuous axis, so there's nothing to fill). */
export function buildModTimelineCommitBuckets(rows: readonly ModTimelineCommitRow[]): ModTimelineBucket[] {
  return rows.map((r) => ({ key: String(r.seq), label: r.date ?? r.sha.slice(0, 10), count: r.count }));
}
