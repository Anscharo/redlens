// atlas_history reads behind atlas_first_seen: the earliest event per doc, its
// source label, and the migration-seam verdict for docs with no `added` event.
import { sql } from "../db.ts";
import { isoDate } from "../chat/tools/tools-history.ts";
import { RECONSTRUCTED_ERAS } from "../../lib/history.ts";

export interface FirstSeen {
  // YYYY-MM-DD, or null if the 'added' event is recorded but genuinely
  // undated — severed-era reconstructions (scripts/prehist/build-genesis.mjs)
  // emit `date: null` on purpose; that's a real record with an unknown date,
  // not a missing one, so it must not be conflated with "no record at all".
  date: string | null;
  // Which atlas_history record backs the date, in descending specificity:
  // a PR number ("pr:1234") when the 'added' event came in through a PR;
  // otherwise the pre-git era tag ("mip" / "genesis-v2" / "html-era" / "severed")
  // when the doc predates git history; otherwise a plain git commit with no PR
  // ("commit:<short sha>").
  // Never confused with an explicit in-content date — this is always derived.
  source: string;
}

export type AddedRow = {
  doc_id: string;
  committed_at: string | Date | null;
  pr_number: number | null;
  pr_title?: string | null;
  era: string | null;
  commit_sha: string;
  commit_seq: number | null;
};

// Display label per reconstructed era (src/lib/history.ts's RECONSTRUCTED_ERAS
// is the canonical membership set — reused here so a new era value only needs
// a label added, not a second parallel vocabulary to keep in sync).
const ERA_LABEL: Record<string, string> = {
  mip: "mip",
  genesis: "genesis-v2",
  html: "html-era",
  severed: "severed",
};

export function sourceLabel(r: AddedRow): string {
  if (r.pr_number != null) return `pr:${r.pr_number}`;
  if (r.era && RECONSTRUCTED_ERAS.has(r.era)) return ERA_LABEL[r.era] ?? r.era;
  return `commit:${r.commit_sha}`;
}

/** The #117 seam verdict for docs that have no `added` event at all, so the caller can
 *  say WHY. `untraced` (the common case) means the reconstruction couldn't attach the doc
 *  to any pre-migration entry — the doc is older than its records, not new. `created` means
 *  a reviewer found no earlier version. Keyed by doc_id; only queried for the docs that
 *  came back empty, so the normal path costs nothing. */
export async function migrationSeamFor(docIds: string[]): Promise<Map<string, string>> {
  if (docIds.length === 0) return new Map();
  const rows = await sql<{ doc_id: string; seam: string }[]>`
    SELECT doc_id, seam FROM atlas_history
    WHERE change_type = 'structural' AND seam IS NOT NULL AND doc_id IN ${sql(docIds)}
  `;
  return new Map(rows.map((r) => [r.doc_id, r.seam]));
}

export const SEAM_NOTE: Record<string, string> = {
  untraced:
    "no 'added' event — this doc's history could not be traced back through the #117 markdown migration, so it is at least as old as that migration (2025-11-21), not newer",
  created:
    "no 'added' event — reviewed as introduced by the #117 markdown migration (2025-11-21); the pre-migration HTML holds no earlier version",
  split:
    "no 'added' event — carved out of a larger document at the #117 markdown migration (2025-11-21); it is at least as old as the document it was extracted from, whose history carries its earlier record",
  reintroduced:
    "no 'added' event — the migration revived a name the pre-migration HTML had already retired, so this doc continues an earlier document under its former name; older than the migration, not new",
};

export type HistoryEvent = "added" | "modified";

function storeChangeType(event: HistoryEvent): "added" | "content" {
  return event === "modified" ? "content" : "added";
}

/** Earliest event per doc_id for the given change_type (`added` default). Empty
 *  input short-circuits to an empty map without touching the DB. Ties (same
 *  committed_at) break on commit_seq so the result is deterministic. */
export async function firstSeenFor(docIds: string[], event: HistoryEvent = "added"): Promise<Map<string, FirstSeen>> {
  const ids = [...new Set(docIds)];
  if (ids.length === 0) return new Map();
  const rows = await firstSeenRowsFor(ids, event);
  const out = new Map<string, FirstSeen>();
  for (const r of rows.values()) {
    // Every row here IS a real event — even a severed-era row with a
    // null committed_at is evidence the doc existed, just undated. Dropping
    // it would silently downgrade "severed, date unknown" to "no record".
    out.set(r.doc_id, { date: isoDate(r.committed_at), source: sourceLabel(r) });
  }
  return out;
}

export async function firstSeenRowsFor(docIds: string[], event: HistoryEvent = "added"): Promise<Map<string, AddedRow>> {
  const ids = [...new Set(docIds)];
  if (ids.length === 0) return new Map();
  const changeType = storeChangeType(event);
  const rows = await sql<AddedRow[]>`
    SELECT DISTINCT ON (doc_id) doc_id, committed_at, pr_number, pr_title, era, commit_sha, commit_seq
    FROM atlas_history
    WHERE change_type = ${changeType} AND doc_id IN ${sql(ids)}
    ORDER BY doc_id, committed_at ASC NULLS LAST, commit_seq ASC NULLS LAST
  `;
  return new Map(rows.map((r) => [r.doc_id, r]));
}
