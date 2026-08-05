// GET /api/history/mod-counts — per-doc counts of strict content edits, for
// the Modification Frequency report. One row per doc that has any `content`
// history row; docs with no content history are absent (the client zero-fills
// from docs.json).
//
// Only `change_type = 'content'` rows count (moves/renames/renumbers are
// `structural` and never appear here); of those, COUNTED_CONTENT_EDIT
// (history-db.ts) decides which are "real" edits. One consequence, intended:
// title-only renames (content rows with no diff and no change_kind) are
// excluded.
import { sql } from "../db.ts";
import { toIsoDate } from "./history.ts";
import { COUNTED_CONTENT_EDIT as COUNTED } from "./history-db.ts";

interface ModCountQueryRow {
  doc_id: string;
  semantic_count: number;
  last_semantic_at: string | Date | null;
  content_count: number;
}

export async function handleModCounts(): Promise<Response> {
  try {
    // ::int — COUNT is bigint, which Bun.sql may surface as a string.
    const rows = await sql.unsafe(`
      SELECT doc_id,
             COUNT(*) FILTER (WHERE ${COUNTED})::int AS semantic_count,
             MAX(committed_at) FILTER (WHERE ${COUNTED}) AS last_semantic_at,
             COUNT(*)::int AS content_count
      FROM atlas_history
      WHERE change_type = 'content'
      GROUP BY doc_id
    `) as ModCountQueryRow[];
    return Response.json(
      rows.map((r) => ({
        docId: r.doc_id,
        count: r.semantic_count,
        lastModified: r.last_semantic_at ? toIsoDate(r.last_semantic_at) : null,
        contentCount: r.content_count,
      })),
      { headers: { "Cache-Control": "public, max-age=300" } },
    );
  } catch {
    return new Response(null, { status: 503 });
  }
}
