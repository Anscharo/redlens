// GET /api/history/mod-counts — per-doc counts of strict content edits, for
// the Modification Frequency report. One row per doc that has any `content`
// history row; docs with no content history are absent (the client zero-fills
// from docs.json).
//
// "Modified" is deliberately strict: only `change_type = 'content'` rows count
// (moves/renames/renumbers are `structural` and never appear here), and of
// those only semantic edits — `change_kind = 'semantic'`. Two consequences,
// both intended:
//   · title-only renames (content rows with an empty diff and null change_kind)
//     are excluded;
//   · markdown-era rows written before migration 006 backfill have null
//     change_kind and are excluded until `pnpm build:history --full` runs.
// The one rescue: reconstructed-era rows (era set — html/mip/genesis) predate
// kind classification entirely, so those count when they carry a real diff
// (18 such rows in the frozen html-era artifact; the pre-git eras emit no
// content rows at all).
import { sql } from "../db.ts";
import { toIsoDate } from "./history.ts";

interface ModCountQueryRow {
  doc_id: string;
  semantic_count: number;
  last_semantic_at: string | Date | null;
  content_count: number;
}

const COUNTED = `change_kind = 'semantic'
                 OR (change_kind IS NULL AND era IS NOT NULL AND diff IS NOT NULL)`;

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
