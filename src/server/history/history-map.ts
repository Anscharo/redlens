import type { DiffLine, HistoryEntry } from "../../lib/history.ts";
import { userType } from "./change-type.ts";
import { entrySpells } from "./entry-spells.ts";

export interface HistoryQueryRow {
  commit_sha: string;
  commit_seq: number | null;
  committed_at: string | Date | null;
  change_type: string;
  pr_number: number | null;
  pr_title: string | null;
  pr_url: string | null;
  pr_author: string | null;
  summary: string | null;
  description: string | null;
  moved_from: string | null;
  moved_to: string | null;
  diff: DiffLine[] | string | null;
  change_kind: string | null;
  review_count: number | null;
  approval_count: number | null;
  comment_count: number | null;
  era: string | null;
  method: string | null;
  source_url: string | null;
  seam: string | null;
  pr_spell_refs?: unknown;
}

/** committed_at is a TIMESTAMPTZ. The reader wants a plain `YYYY-MM-DD`. */
export function toIsoDate(v: HistoryQueryRow["committed_at"]): string {
  if (!v) return "";
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? String(v).slice(0, 10) : d.toISOString().slice(0, 10);
}

function toDiff(v: HistoryQueryRow["diff"]): DiffLine[] | undefined {
  let d: unknown = v;
  if (typeof d === "string") {
    try {
      d = JSON.parse(d);
    } catch {
      return undefined;
    }
  }
  return Array.isArray(d) ? (d as DiffLine[]) : undefined;
}

function copyPresent(entry: HistoryEntry, fields: Partial<HistoryEntry>) {
  for (const [key, value] of Object.entries(fields)) {
    if (value != null && value !== "") (entry as unknown as Record<string, unknown>)[key] = value;
  }
}

export function toEntry(row: HistoryQueryRow): HistoryEntry {
  const entry: HistoryEntry = {
    date: toIsoDate(row.committed_at),
    commitHash: row.commit_sha,
    changeType: userType(row.change_type) as HistoryEntry["changeType"],
  };
  copyPresent(entry, rowFields(row));
  const diff = toDiff(row.diff);
  if (diff) entry.diff = diff;
  entry.spells = entrySpells(row, entry.date);
  return entry;
}

function rowFields(row: HistoryQueryRow): Partial<HistoryEntry> {
  return {
    pr: row.pr_number ?? undefined,
    prTitle: row.pr_title ?? undefined,
    prAuthor: row.pr_author ?? undefined,
    prUrl: row.pr_url ?? undefined,
    summary: row.summary ?? undefined,
    description: row.description ?? undefined,
    movedFrom: row.moved_from ?? undefined,
    movedTo: row.moved_to ?? undefined,
    changeKind: (row.change_kind ?? undefined) as HistoryEntry["changeKind"],
    reviewCount: row.review_count ?? undefined,
    approvalCount: row.approval_count ?? undefined,
    commentCount: row.comment_count ?? undefined,
    era: row.era ?? undefined,
    method: (row.method ?? undefined) as HistoryEntry["method"],
    commitSeq: row.commit_seq ?? undefined,
    sourceUrl: row.source_url ?? undefined,
    seam: row.seam ?? undefined,
  };
}
