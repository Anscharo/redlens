// GET /api/history/mod-timeline — semantic content edits per calendar month,
// for the Modification Frequency report's timeline chart. One row per month
// that has at least one matching edit; months with none are absent (the
// client zero-fills gaps between the earliest and latest month it sees).
//
// Same strict "modified" predicate as mod-counts.ts (COUNTED): only
// `change_type = 'content'` rows, and of those only semantic edits (or, for
// rows with no change_kind yet, a real stored diff) — see that file's header
// for the full rationale. Rows with no committed_at (a severed-era birth,
// which carries only a date window, not an exact date — see severedRange in
// ../../lib/history.ts) can't be placed on a month axis, so they're excluded.
import { sql } from "../db.ts";

interface ModTimelineQueryRow {
  month: string;
  count: number;
}

const COUNTED = `change_kind = 'semantic'
                 OR (change_kind IS NULL AND diff IS NOT NULL)`;

export async function handleModTimeline(): Promise<Response> {
  try {
    // ::int — COUNT is bigint, which Bun.sql may surface as a string.
    const rows = (await sql.unsafe(`
      SELECT to_char(date_trunc('month', committed_at), 'YYYY-MM') AS month,
             COUNT(*)::int AS count
      FROM atlas_history
      WHERE change_type = 'content' AND committed_at IS NOT NULL AND (${COUNTED})
      GROUP BY month
      ORDER BY month
    `)) as ModTimelineQueryRow[];
    return Response.json(
      rows.map((r) => ({ month: r.month, count: r.count })),
      { headers: { "Cache-Control": "public, max-age=300" } },
    );
  } catch {
    return new Response(null, { status: 503 });
  }
}
