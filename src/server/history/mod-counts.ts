// GET /api/history/mod-counts — per-doc counts of strict content edits, for
// the Modification Frequency report. One row per doc that has any `content`
// history row; docs with no content history are absent (the client zero-fills
// from docs.json).
//
// "Modified" is deliberately strict: only `change_type = 'content'` rows count
// (moves/renames/renumbers are `structural` and never appear here), and of
// those only semantic edits — `change_kind = 'semantic'`. One consequence,
// intended: title-only renames (content rows with no diff and no change_kind)
// are excluded.
//
// Rows with no change_kind at all — either reconstructed-era rows (predate
// kind classification) or markdown-era rows written before migration 006's
// `pnpm build:history --full` backfill has reached them — fall back to
// diff-based counting: a real stored diff means a real content edit, so it
// counts. Without this fallback, un-backfilled markdown-era edits would read
// as `count: 0` and rank as "never modified" instead of just undercounting
// (they still miss edits whose diff wasn't stored) until the backfill runs.
import { sql } from "../db.ts";
import { toIsoDate } from "./history.ts";

interface ModCountQueryRow {
  doc_id: string;
  semantic_count: number;
  last_semantic_at: string | Date | null;
  content_count: number;
}

const COUNTED = `change_kind = 'semantic'
                 OR (change_kind IS NULL AND diff IS NOT NULL)`;

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
