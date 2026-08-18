// GET /api/history/:nodeId — serve atlas_history rows for a single node.
// Replaces the former public/history/<uuid>.json static files.
import { sql } from "../db.ts";
import { json } from "../http.ts";
import { BATCH_MAX, type HistoryEntry, type DiffLine } from "../../lib/history.ts";
import { UUID_RE } from "../../lib/patterns.ts";

// Every non-2xx below carries the `{ error }` envelope the rest of the API uses
// (auth.ts, collections.ts, conversations.ts) instead of an empty body, so a
// client can read one shape everywhere. The STATUS codes are unchanged and
// remain the contract: src/lib/history.ts's fetchCached treats 404 as a stable
// "no data" (cached) and anything else as transient (evicted, retried).

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
  commit_seq: number | null;
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
  change_kind: string | null;
  review_count: number | null;
  approval_count: number | null;
  comment_count: number | null;
  era: string | null;
  method: string | null;
  source_url: string | null;
  seam: string | null;
}

/** committed_at is a TIMESTAMPTZ — Bun.sql hands it back as a Date (or an ISO
 *  string). The frontend renders/sorts on a plain `YYYY-MM-DD`, so normalise.
 *  Shared with the mod-counts aggregate (mod-counts.ts). */
export function toIsoDate(v: HistoryQueryRow["committed_at"]): string {
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
  if (row.change_kind) entry.changeKind = row.change_kind as HistoryEntry["changeKind"];
  if (row.review_count != null) entry.reviewCount = row.review_count;
  if (row.approval_count != null) entry.approvalCount = row.approval_count;
  if (row.comment_count != null) entry.commentCount = row.comment_count;
  if (row.era) entry.era = row.era;
  if (row.method) entry.method = row.method as HistoryEntry["method"];
  if (row.commit_seq != null) entry.commitSeq = row.commit_seq;
  if (row.source_url) entry.sourceUrl = row.source_url;
  if (row.seam) entry.seam = row.seam;
  return entry;
}

export async function handleHistory(_req: Request, pathname: string): Promise<Response> {
  const nodeId = pathname.slice("/api/history/".length);
  if (!UUID_RE.test(nodeId)) return json({ error: "not_found" }, 404);

  try {
    const rows = await sql<HistoryQueryRow[]>`
      SELECT h.commit_sha, h.commit_seq, h.committed_at, h.change_type, h.pr_number,
             COALESCE(h.pr_title, p.title) AS pr_title,
             COALESCE(h.pr_url, p.url) AS pr_url,
             COALESCE(h.pr_author, p.author) AS pr_author,
             h.summary, h.description, h.moved_from, h.moved_to, h.diff,
             h.change_kind,
             COALESCE(h.review_count, p.review_count) AS review_count,
             COALESCE(h.approval_count, p.approval_count) AS approval_count,
             COALESCE(h.comment_count, p.comment_count) AS comment_count,
             h.era, h.method, h.source_url, h.seam
      FROM atlas_history h LEFT JOIN atlas_prs p ON p.pr_number = h.pr_number
      WHERE h.doc_id = ${nodeId}
      ORDER BY h.commit_seq DESC NULLS LAST, h.committed_at DESC NULLS LAST
    `;
    return Response.json(rows.map(toEntry), {
      headers: { "Cache-Control": "public, max-age=300" },
    });
  } catch {
    return json({ error: "unavailable" }, 503);
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
    return json({ error: "bad_request" }, 400);
  }
  const raw = (body as { ids?: unknown })?.ids;
  if (!Array.isArray(raw)) return json({ error: "bad_request" }, 400);

  const ids = [...new Set(raw.filter((x): x is string => typeof x === "string" && UUID_RE.test(x)))].slice(
    0,
    BATCH_MAX,
  );
  // No Cache-Control: this is a POST, which browsers don't cache anyway. The
  // single-doc GET caches; here the client-side `loadHistoryBatch` cache seed
  // is what avoids refetching.
  if (ids.length === 0) return Response.json({});

  try {
    const rows = await sql<(HistoryQueryRow & { doc_id: string })[]>`
      SELECT h.doc_id, h.commit_sha, h.commit_seq, h.committed_at, h.change_type, h.pr_number,
             COALESCE(h.pr_title, p.title) AS pr_title,
             COALESCE(h.pr_url, p.url) AS pr_url,
             COALESCE(h.pr_author, p.author) AS pr_author,
             h.summary, h.description, h.moved_from, h.moved_to, h.diff,
             h.change_kind,
             COALESCE(h.review_count, p.review_count) AS review_count,
             COALESCE(h.approval_count, p.approval_count) AS approval_count,
             COALESCE(h.comment_count, p.comment_count) AS comment_count,
             h.era, h.method, h.source_url, h.seam
      FROM atlas_history h LEFT JOIN atlas_prs p ON p.pr_number = h.pr_number
      WHERE h.doc_id IN ${sql(ids)}
      ORDER BY h.commit_seq DESC NULLS LAST, h.committed_at DESC NULLS LAST
    `;
    const out: Record<string, HistoryEntry[]> = {};
    for (const row of rows) (out[row.doc_id] ??= []).push(toEntry(row));
    return Response.json(out);
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}
