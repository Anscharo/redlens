// Pure data logic for the Modification Frequency report (/reports/mod-frequency):
// every atlas doc ranked by how rarely its content has been edited. Counts come
// from GET /api/history/mod-counts (see ModCount in history.ts) — strict content
// edits only, never moves/renames/renumbers. Docs absent from the counts (no
// content history at all) zero-fill and therefore lead the ranking.
import type { AtlasNode } from "../types";
import type { ModCount } from "./history";
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
 *  sorted least-frequently-modified first. */
export function buildModFrequencyRows(
  docs: Record<string, AtlasNode>,
  counts: ModCount[],
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
 *  group. Section groups order by section doc_no, type groups alphabetically. */
export function groupModFrequencyRows(
  rows: readonly ModFrequencyRow[],
  grouping: ModFrequencyGrouping,
): ModFrequencyGroup[] {
  const groups = new Map<string, ModFrequencyGroup>();
  for (const r of rows) {
    const key = grouping === "section" ? r.section : r.type;
    let g = groups.get(key);
    if (!g) {
      const label =
        grouping === "section" && r.sectionTitle !== r.section
          ? `${r.section} — ${r.sectionTitle}`
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
  /** Docs in this category with zero recorded modifications. */
  zeroCount: number;
  /** zeroCount / total, as a 0–100 percentage (0 when total is 0). */
  zeroPercent: number;
}

/** Per-category rollup: how many docs in each section/type have never been
 *  modified, as a share of every doc in that category — not just the
 *  ≤1-modification subset the doc-level table below is filtered to. Built
 *  from the full (unfiltered) row set so the denominator is the category's
 *  true size. */
export function summarizeZeroModFrequency(
  rows: readonly ModFrequencyRow[],
  grouping: ModFrequencyGrouping,
): ModFrequencySummaryRow[] {
  // groupModFrequencyRows only ever emits groups it found at least one row
  // for, so g.rows.length is always >= 1 here — no zero-division guard needed.
  return groupModFrequencyRows(rows, grouping).map((g) => {
    const zeroCount = g.rows.filter((r) => r.count === 0).length;
    return {
      key: g.key,
      label: g.label,
      total: g.rows.length,
      zeroCount,
      zeroPercent: (zeroCount / g.rows.length) * 100,
    };
  });
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
