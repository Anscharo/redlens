// GET /api/history/:nodeId — serve atlas_history rows for a single node.
// Replaces the former public/history/<uuid>.json static files.
import { sql } from "./db.ts";
import { BATCH_MAX, type HistoryEntry, type DiffLine } from "../lib/history.ts";
import { UUID_RE } from "../lib/patterns.ts";

// Postgres stores "content" / "structural" (chatbot-plan vocabulary);
// the frontend HistoryEntry uses "modified" / "moved".
const CHANGE_TYPE_REVERSE: Record<string, HistoryEntry["changeType"]> = {
  content: "modified",
  structural: "moved",
  added: "added",
  removed: "removed",
};

interface HistoryQueryRow {
  commit_sha: string;
  // TIMESTAMPTZ comes back as a Date (or ISO string); JSONB diff normally an
  // array, but legacy double-encoded rows come back as a JSON string.
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
}

/** committed_at is a TIMESTAMPTZ — Bun.sql hands it back as a Date (or an ISO
 *  string). The frontend renders/sorts on a plain `YYYY-MM-DD`, so normalise. */
function toIsoDate(v: HistoryQueryRow["committed_at"]): string {
  if (!v) return "";
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? String(v).slice(0, 10) : d.toISOString().slice(0, 10);
}

/** Older rows were written with a double-encoded diff (a JSON *string* inside
 *  the JSONB column) which crashes DiffView's `.map`. Parse those back to an
 *  array; only surface a diff when it's genuinely an array. */
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

export function toEntry(row: HistoryQueryRow): HistoryEntry {
  const entry: HistoryEntry = {
    date: toIsoDate(row.committed_at),
    commitHash: row.commit_sha,
    changeType: CHANGE_TYPE_REVERSE[row.change_type] ?? (row.change_type as HistoryEntry["changeType"]),
  };
  if (row.pr_number != null) entry.pr = row.pr_number;
  if (row.pr_title) entry.prTitle = row.pr_title;
  if (row.pr_author) entry.prAuthor = row.pr_author;
  if (row.pr_url) entry.prUrl = row.pr_url;
  if (row.summary) entry.summary = row.summary;
  if (row.description) entry.description = row.description;
  const diff = toDiff(row.diff);
  if (diff) entry.diff = diff;
  if (row.moved_from) entry.movedFrom = row.moved_from;
  if (row.moved_to) entry.movedTo = row.moved_to;
  return entry;
}

export async function handleHistory(_req: Request, pathname: string): Promise<Response> {
  const nodeId = pathname.slice("/api/history/".length);
  if (!UUID_RE.test(nodeId)) return new Response(null, { status: 404 });

  try {
    const rows = await sql<HistoryQueryRow[]>`
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

/** POST /api/history/batch — body `{ ids: string[] }`. Returns the change log
 *  for many docs in one round-trip, keyed by doc_id, so the radar actor view
 *  doesn't fan out into hundreds of `/api/history/:id` requests. Docs with no
 *  history are simply absent from the response. */
export async function handleHistoryBatch(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(null, { status: 400 });
  }
  const raw = (body as { ids?: unknown })?.ids;
  if (!Array.isArray(raw)) return new Response(null, { status: 400 });

  const ids = [...new Set(raw.filter((x): x is string => typeof x === "string" && UUID_RE.test(x)))].slice(
    0,
    BATCH_MAX,
  );
  if (ids.length === 0) return Response.json({}, { headers: { "Cache-Control": "public, max-age=300" } });

  try {
    const rows = await sql<(HistoryQueryRow & { doc_id: string })[]>`
      SELECT doc_id, commit_sha, committed_at, change_type, pr_number, pr_title, pr_url,
             pr_author, summary, description, moved_from, moved_to, diff
      FROM atlas_history
      WHERE doc_id IN ${sql(ids)}
      ORDER BY commit_seq DESC NULLS LAST, committed_at DESC NULLS LAST
    `;
    const out: Record<string, HistoryEntry[]> = {};
    for (const row of rows) (out[row.doc_id] ??= []).push(toEntry(row));
    return Response.json(out, { headers: { "Cache-Control": "public, max-age=300" } });
  } catch {
    return new Response(null, { status: 503 });
  }
}
