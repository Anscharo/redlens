// GET /api/history/:nodeId — serve atlas_history rows for a single node.
// Replaces the former public/history/<uuid>.json static files.
import { sql } from "../db.ts";
import { json } from "../http.ts";
import { BATCH_MAX, type HistoryEntry } from "../../lib/history.ts";
import { UUID_RE } from "../../lib/patterns.ts";
import { toEntry, type HistoryQueryRow } from "./history-map.ts";

export { toEntry, toIsoDate } from "./history-map.ts";

// Every non-2xx below carries the `{ error }` envelope the rest of the API uses
// (auth.ts, collections.ts, conversations.ts) instead of an empty body, so a
// client can read one shape everywhere. The STATUS codes are unchanged and
// remain the contract: src/lib/history.ts's fetchCached treats 404 as a stable
// "no data" (cached) and anything else as transient (evicted, retried).

export async function handleHistory(_req: Request, pathname: string): Promise<Response> {
  const nodeId = pathname.slice("/api/history/".length);
  if (!UUID_RE.test(nodeId)) return json({ error: "not_found" }, 404);

  try {
    const rows = await rowsForDoc(nodeId);
    return Response.json(rows.map(toEntry), { headers: { "Cache-Control": "public, max-age=300" } });
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}

function rowsForDoc(nodeId: string) {
  return sql<HistoryQueryRow[]>`
    SELECT h.commit_sha, h.commit_seq, h.committed_at, h.change_type, h.pr_number,
           COALESCE(h.pr_title, p.title) AS pr_title,
           COALESCE(h.pr_url, p.url) AS pr_url,
           COALESCE(h.pr_author, p.author) AS pr_author,
           h.summary, h.description, h.moved_from, h.moved_to, h.diff, h.change_kind,
           COALESCE(h.review_count, p.review_count) AS review_count,
           COALESCE(h.approval_count, p.approval_count) AS approval_count,
           COALESCE(h.comment_count, p.comment_count) AS comment_count,
           h.era, h.method, h.source_url, h.seam, p.spell_refs AS pr_spell_refs
    FROM atlas_history h LEFT JOIN atlas_prs p ON p.pr_number = h.pr_number
    WHERE h.doc_id = ${nodeId}
    ORDER BY h.commit_seq DESC NULLS LAST, h.committed_at DESC NULLS LAST
  `;
}

/** The change log of each document in `ids` (UUIDs), newest first; a document with no history is absent. Throws when the database cannot be read. */
export async function readHistoryBatch(ids: readonly string[]): Promise<Map<string, HistoryEntry[]>> {
  if (ids.length === 0) return new Map();
  return groupRows(await rowsForDocs(ids));
}

function rowsForDocs(ids: readonly string[]) {
  return sql<(HistoryQueryRow & { doc_id: string })[]>`
    SELECT h.doc_id, h.commit_sha, h.commit_seq, h.committed_at, h.change_type, h.pr_number,
           COALESCE(h.pr_title, p.title) AS pr_title,
           COALESCE(h.pr_url, p.url) AS pr_url,
           COALESCE(h.pr_author, p.author) AS pr_author,
           h.summary, h.description, h.moved_from, h.moved_to, h.diff, h.change_kind,
           COALESCE(h.review_count, p.review_count) AS review_count,
           COALESCE(h.approval_count, p.approval_count) AS approval_count,
           COALESCE(h.comment_count, p.comment_count) AS comment_count,
           h.era, h.method, h.source_url, h.seam, p.spell_refs AS pr_spell_refs
    FROM atlas_history h LEFT JOIN atlas_prs p ON p.pr_number = h.pr_number
    WHERE h.doc_id IN ${sql(ids as string[])}
    ORDER BY h.commit_seq DESC NULLS LAST, h.committed_at DESC NULLS LAST
  `;
}

function groupRows(rows: (HistoryQueryRow & { doc_id: string })[]) {
  const out = new Map<string, HistoryEntry[]>();
  for (const row of rows) {
    const list = out.get(row.doc_id);
    if (list) list.push(toEntry(row));
    else out.set(row.doc_id, [toEntry(row)]);
  }
  return out;
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
    return Response.json(Object.fromEntries(await readHistoryBatch(ids)));
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}
