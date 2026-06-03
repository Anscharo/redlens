// GET /api/history/:nodeId — serve atlas_history rows for a single node.
// Replaces the former public/history/<uuid>.json static files.
import { sql } from "./db.ts";
import type { HistoryEntry, DiffLine } from "../lib/history.ts";
import { UUID_RE } from "../lib/patterns.ts";

// Postgres stores "content" / "structural" (chatbot-plan vocabulary);
// the frontend HistoryEntry uses "modified" / "moved".
const CHANGE_TYPE_REVERSE: Record<string, HistoryEntry["changeType"]> = {
  content: "modified",
  structural: "moved",
  added: "added",
  removed: "removed",
};

interface HistoryRow {
  commit_sha: string;
  committed_at: string | null;
  change_type: string;
  pr_number: number | null;
  pr_title: string | null;
  pr_url: string | null;
  pr_author: string | null;
  summary: string | null;
  description: string | null;
  moved_from: string | null;
  moved_to: string | null;
  diff: DiffLine[] | null;
}

function toEntry(row: HistoryRow): HistoryEntry {
  const entry: HistoryEntry = {
    date: row.committed_at ?? "",
    commitHash: row.commit_sha,
    changeType: CHANGE_TYPE_REVERSE[row.change_type] ?? (row.change_type as HistoryEntry["changeType"]),
  };
  if (row.pr_number != null) entry.pr = row.pr_number;
  if (row.pr_title) entry.prTitle = row.pr_title;
  if (row.pr_author) entry.prAuthor = row.pr_author;
  if (row.pr_url) entry.prUrl = row.pr_url;
  if (row.summary) entry.summary = row.summary;
  if (row.description) entry.description = row.description;
  if (row.diff) entry.diff = row.diff;
  if (row.moved_from) entry.movedFrom = row.moved_from;
  if (row.moved_to) entry.movedTo = row.moved_to;
  return entry;
}

export async function handleHistory(_req: Request, pathname: string): Promise<Response> {
  const nodeId = pathname.slice("/api/history/".length);
  if (!UUID_RE.test(nodeId)) return new Response(null, { status: 404 });

  try {
    const rows = await sql<HistoryRow[]>`
      SELECT commit_sha, committed_at, change_type, pr_number, pr_title, pr_url,
             pr_author, summary, description, moved_from, moved_to, diff
      FROM atlas_history
      WHERE doc_id = ${nodeId}
      ORDER BY commit_seq DESC NULLS LAST, committed_at DESC NULLS LAST
    `;
    return Response.json(rows.map(toEntry), {
      headers: { "Cache-Control": "public, max-age=300" },
    });
  } catch {
    return new Response(null, { status: 503 });
  }
}
