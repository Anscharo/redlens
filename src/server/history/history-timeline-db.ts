// Post-migration edit history for HTML-era curation subjects (plan §10.4 timeline
// enrichment). For a seed-close case the newer document IS the final #117 markdown
// doc (a real UUID) — what happened to it AFTER the migration lives in the modern
// atlas_history table (src/server/history/history-db.ts), a separate pipeline from the
// HTML-era one. Whether it kept being edited under a stable topic (continuity — a
// point in favor of the pairing) or was deleted soon after (a red flag) is
// corroborating evidence the curation prompt otherwise can't see. Offline curation
// tooling only; batched by doc_id, only meaningful for seed-close subjects.
import type { SQL } from "bun";

export interface PostMigrationRow {
  doc_id: string;
  commit_seq: number | null;
  committed_at: string | null;
  change_type: string;
  pr_title: string | null;
}

export interface PostMigrationHistory {
  edits: Array<{ date: string | null; prTitle: string | null }>;
  deletedAt: string | null;
}

/** Pure grouping — testable without a DB. Assumes rows are already filtered to
 *  commit_seq > sinceSeq and ordered ascending by commit_seq (ties broken by
 *  committed_at), the order fetchPostMigrationHistory's query produces. */
export function groupPostMigrationRows(rows: PostMigrationRow[]): Map<string, PostMigrationHistory> {
  const out = new Map<string, PostMigrationHistory>();
  for (const r of rows) {
    let h = out.get(r.doc_id);
    if (!h) out.set(r.doc_id, (h = { edits: [], deletedAt: null }));
    if (r.change_type === "removed") h.deletedAt = r.committed_at;
    else h.edits.push({ date: r.committed_at, prTitle: r.pr_title });
  }
  for (const h of out.values()) h.edits.reverse(); // most-recent-first, for the prompt/UI
  return out;
}

/** Batch-fetch post-migration history for a set of doc UUIDs: everything strictly
 *  after `sinceSeq` (the migration commit's commit_seq — see gitCommitSeq in
 *  history-db.ts). Offline curation tooling only. */
export async function fetchPostMigrationHistory(
  sql: SQL,
  docIds: string[],
  sinceSeq: number,
): Promise<Map<string, PostMigrationHistory>> {
  if (!docIds.length) return new Map();
  const rows = await sql<PostMigrationRow[]>`
    SELECT h.doc_id, h.commit_seq, h.committed_at, h.change_type,
           COALESCE(h.pr_title, p.title) AS pr_title
    FROM atlas_history h LEFT JOIN atlas_prs p ON p.pr_number = h.pr_number
    WHERE h.doc_id IN ${sql(docIds)} AND h.commit_seq > ${sinceSeq}
    ORDER BY h.commit_seq ASC NULLS LAST, h.committed_at ASC NULLS LAST
  `;
  return groupPostMigrationRows(rows);
}
