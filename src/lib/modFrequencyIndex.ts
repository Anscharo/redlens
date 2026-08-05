// Pure data logic for the Modification Frequency report (/reports/mod-frequency):
// every atlas doc ranked by how rarely its content has been edited. Counts come
// from GET /api/history/mod-counts (see ModCount in history.ts) — strict content
// edits only, never moves/renames/renumbers. Docs absent from the counts (no
// content history at all) zero-fill and therefore lead the ranking.
import type { AtlasNode } from "../types";
import type { ModCount, ModTimelineRow } from "./history";
import { toCSV } from "./csv";
import { atlasUrl } from "./routes";
import type { SearchField } from "./reportFilter";

export interface ModFrequencyRow {
  id: string;
  docNo: string;
  title: string;
  type: string;
  /** Two-segment scope doc_no (A.0–A.6); shorter doc_nos (the root) keep their
   *  own doc_no, and NR-X docs collapse to their spec-defined "NR" family. */
  section: string;
  /** The scope node's title, falling back to the section doc_no itself. */
  sectionTitle: string;
  /** Semantic content edits — the report's "modifications". */
  count: number;
  /** YYYY-MM-DD of the latest counted edit; null = never modified. */
  lastModified: string | null;
  /** The Prime/Executor Agent whose artifact subtree this doc lives under
   *  (only ever non-null under A.6, the Agent Scope), or null. From
   *  buildOwningAgentMap — null in preview mode or when the graph hasn't
   *  loaded yet. */
  agent: string | null;
}

// NR-X (Needed Research) is a spec-defined structural pattern
// (ATLAS_MARKDOWN_SYNTAX.md), so matching on it is stable — unlike editorial
// doc_nos, which are never hardcoded.
const NR_FAMILY_RE = /^([A-Za-z]+)-\d+$/;

/** Two-segment doc_no prefix — the A.0–A.6 scope a doc lives under. Derived
 *  from doc_no, not parentId: the heading-depth cap (6) makes parentId
 *  unreliable for deep nodes (same reasoning as computeLabels in hitLabels.ts). */
export function sectionOf(docNo: string): string {
  const parts = docNo.split(".");
  if (parts.length >= 2) return parts.slice(0, 2).join(".");
  return NR_FAMILY_RE.exec(docNo)?.[1] ?? docNo;
}

function cmpLastModified(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1; // never modified sorts before any date
  if (b === null) return 1;
  return a < b ? -1 : 1; // ISO dates compare lexically
}

/** One row per doc in docs.json, merged with the server tallies (zero-filled
 *  when absent; count rows for docs no longer in the atlas are dropped),
 *  sorted least-frequently-modified first. `agentByDoc` (from
 *  buildOwningAgentMap) is optional — omit it and every row's agent is null. */
export function buildModFrequencyRows(
  docs: Record<string, AtlasNode>,
  counts: ModCount[],
  agentByDoc: ReadonlyMap<string, string> = new Map(),
): ModFrequencyRow[] {
  const byId = new Map(counts.map((c) => [c.docId, c]));
  const titleByDocNo = new Map<string, string>();
  for (const d of Object.values(docs)) titleByDocNo.set(d.doc_no, d.title);

  const rows = Object.values(docs).map((d): ModFrequencyRow => {
    const c = byId.get(d.id);
    const section = sectionOf(d.doc_no);
    return {
      id: d.id,
      docNo: d.doc_no,
      title: d.title,
      type: d.type,
      section,
      sectionTitle: titleByDocNo.get(section) ?? section,
      count: c?.count ?? 0,
      lastModified: c?.lastModified ?? null,
      agent: agentByDoc.get(d.id) ?? null,
    };
  });

  return rows.sort(
    (a, b) =>
      a.count - b.count ||
      cmpLastModified(a.lastModified, b.lastModified) ||
      a.docNo.localeCompare(b.docNo, undefined, { numeric: true }),
  );
}

export type ModFrequencyGrouping = "section" | "type";
export const GROUPINGS: readonly ModFrequencyGrouping[] = ["section", "type"];

export interface ModFrequencyGroup {
  key: string;
  label: string;
  rows: ModFrequencyRow[];
}

/** Buckets the (already-sorted) rows; rows keep their global order inside each
 *  group. Section groups order by section doc_no, type groups alphabetically.
 *  A section whose rows carry an `agent` (only ever A.6, the Agent Scope —
 *  see buildOwningAgentMap) further splits into one group per agent instead
 *  of one lumped section bucket; the agent-less remainder (the scope's own
 *  structural docs and each agent's own root doc, which is self-excluded)
 *  keeps the plain section bucket. The ":" key separator sorts every agent
 *  subgroup immediately after that plain bucket. */
export function groupModFrequencyRows(
  rows: readonly ModFrequencyRow[],
  grouping: ModFrequencyGrouping,
): ModFrequencyGroup[] {
  const groups = new Map<string, ModFrequencyGroup>();
  for (const r of rows) {
    const key = grouping === "section" ? (r.agent ? `${r.section}:${r.agent}` : r.section) : r.type;
    let g = groups.get(key);
    if (!g) {
      const label =
        grouping === "section"
          ? r.agent
            ? `${r.section} — ${r.agent}`
            : r.sectionTitle !== r.section
              ? `${r.section} — ${r.sectionTitle}`
              : key
          : key;
      groups.set(key, (g = { key, label, rows: [] }));
    }
    g.rows.push(r);
  }
  return [...groups.values()].sort((a, b) =>
    a.key.localeCompare(b.key, undefined, { numeric: true }),
  );
}

export interface ModFrequencySummaryRow {
  key: string;
  label: string;
  /** All docs in this category, regardless of edit count. */
  total: number;
  /** Docs in this category matching the active filter predicate. */
  matchCount: number;
  /** matchCount / total, as a 0–100 percentage (0 when total is 0). */
  matchPercent: number;
}

/** Per-category rollup: how many docs in each section/type match the given
 *  predicate (the same one filtering the doc-level table below), as a share
 *  of every doc in that category — not just the filtered subset. Built from
 *  the full (unfiltered) row set so the denominator is the category's true
 *  size; `matches` decides the numerator, so the table tracks whatever
 *  threshold/comparator the report's filter is currently set to. */
export function summarizeModFrequencyMatches(
  rows: readonly ModFrequencyRow[],
  grouping: ModFrequencyGrouping,
  matches: (row: ModFrequencyRow) => boolean,
): ModFrequencySummaryRow[] {
  // groupModFrequencyRows only ever emits groups it found at least one row
  // for, so g.rows.length is always >= 1 here — no zero-division guard needed.
  return groupModFrequencyRows(rows, grouping).map((g) => {
    const matchCount = g.rows.filter(matches).length;
    return {
      key: g.key,
      label: g.label,
      total: g.rows.length,
      matchCount,
      matchPercent: (matchCount / g.rows.length) * 100,
    };
  });
}

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
  /** "YYYY-MM". */
  month: string;
  /** "Jan '24" — compact axis label. */
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
export function buildModTimelineBuckets(rows: readonly ModTimelineRow[]): ModTimelineBucket[] {
  if (rows.length === 0) return [];
  const countByMonth = new Map(rows.map((r) => [r.month, r.count]));
  const months = [...countByMonth.keys()].sort();
  const [startYear, startMonth] = months[0].split("-").map(Number);
  const [endYear, endMonth] = months[months.length - 1].split("-").map(Number);

  const buckets: ModTimelineBucket[] = [];
  let year = startYear;
  let month = startMonth;
  while (year < endYear || (year === endYear && month <= endMonth)) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    buckets.push({ month: key, label: monthLabel(year, month), count: countByMonth.get(key) ?? 0 });
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }
  return buckets;
}

/** "lte" keeps docs with count <= threshold; "gt" keeps docs with count >
 *  threshold. One user-typed threshold instead of preset buckets. */
export type FrequencyComparator = "lte" | "gt";
export const FREQUENCY_COMPARATORS: readonly FrequencyComparator[] = ["lte", "gt"];

/** Bounds for the threshold number input — 0 so "≤0 edits" (never modified) is selectable. */
export const FREQUENCY_MIN = 0;
export const FREQUENCY_MAX = 12;
/** Initial threshold when the report first loads (not the input's floor). */
export const FREQUENCY_DEFAULT = 1;

export function matchesFrequency(count: number, comparator: FrequencyComparator, threshold: number): boolean {
  return comparator === "lte" ? count <= threshold : count > threshold;
}

export function modFrequencySummaryToCSV(summary: readonly ModFrequencySummaryRow[]): string {
  return toCSV(
    ["Category", "Total Documents", "Matching Documents", "% Matching"],
    summary.map((s) => [s.label, s.total, s.matchCount, `${s.matchPercent.toFixed(1)}%`]),
  );
}

/** Haystack for the header-box filter — the same fields the table renders. */
export function modFrequencySearchFields(r: ModFrequencyRow): SearchField[] {
  return [
    { label: "doc no", value: r.docNo },
    { label: "title", value: r.title },
    { label: "type", value: r.type },
    { label: "section", value: `${r.section} ${r.sectionTitle}` },
  ];
}

export function modFrequencyRowsToCSV(rows: readonly ModFrequencyRow[]): string {
  return toCSV(
    ["Doc No", "Title", "Type", "Section", "Section Title", "Semantic Edits", "Last Modified", "UUID", "Atlas Link"],
    rows.map((r) => [
      r.docNo,
      r.title,
      r.type,
      r.section,
      r.sectionTitle,
      r.count,
      r.lastModified ?? "never",
      r.id,
      atlasUrl(r.id),
    ]),
  );
}
