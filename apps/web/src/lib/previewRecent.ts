// The /preview index's "my recent previews" data layer: the row shape
// GET /api/preview/mine answers with, and the merge that turns it plus this
// browser's localStorage record into the list the tab renders. Pure (no React),
// so the merge rules are testable without rendering the page.

import { localPreviews, type LocalPreview } from "./previewLocal";
import type { Entry } from "../components/preview/types";

export interface MineRow {
  sha: string;
  repo: string;
  ref: string;
  kind: string;
  pr_number: number | null;
  pr_title: string | null;
  pr_author: string | null;
  pr_state: string | null;
  doc_count: number;
  last_access: string;
  private?: boolean;
  /** ACCOUNT rows only: the id this visitor opened, and their own last open of
   *  it. A row that came back solely because this browser sent its sha carries
   *  neither — its id and timestamp live in localStorage. */
  preview_id?: string;
  opened_at?: string;
}

function detailOf(row: MineRow): string {
  return [
    row.private && "private",
    row.pr_author && `by ${row.pr_author}`,
    row.pr_state && row.pr_state !== "open" && row.pr_state,
    `${row.doc_count} docs`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Merge both sources into one newest-first list, keyed by preview id.
 *
 *  ACCOUNT rows (preview_id set) stand on their own: they name a preview this
 *  account opened on ANY device, including one this browser has never seen —
 *  which is the whole point of recording them server-side.
 *
 *  BROWSER rows still require the intersection: a local entry appears only once
 *  the server confirms its sha is live, so a wiped DB or a blocked sha can't
 *  leave a dead row in the list.
 *
 *  Where both describe the same id, the NEWER open wins the row too, not just
 *  the timestamp: a pushed branch moves its title and doc count, and the stale
 *  side would otherwise label the entry. */
export function mergeRecentPreviews(rows: MineRow[], local: LocalPreview[] = localPreviews()): Entry[] {
  const bySha = new Map(rows.map((r) => [r.sha, r]));
  const best = new Map<string, { row: MineRow; at: number }>();
  const offer = (id: string, row: MineRow, at: number) => {
    const prev = best.get(id);
    if (!prev || at > prev.at) best.set(id, { row, at });
  };
  for (const row of rows) {
    if (row.preview_id) offer(row.preview_id, row, Date.parse(row.opened_at ?? "") || 0);
  }
  for (const l of local) {
    const row = bySha.get(l.sha);
    if (row) offer(l.id, row, l.at);
  }
  return [...best.entries()]
    .map(([id, { row, at }]) => ({ id, title: row.pr_title ?? undefined, detail: detailOf(row), at }))
    .sort((a, b) => b.at - a.at);
}
