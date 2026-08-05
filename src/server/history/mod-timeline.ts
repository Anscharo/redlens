// GET /api/history/mod-timeline?granularity=month|week|commit — semantic
// content edits bucketed by calendar month/week, or one row per commit, for
// the Modification Frequency report's timeline chart.
//
// month/week: one row per period that has at least one matching edit;
// periods with none are absent (the client zero-fills the gaps between the
// earliest and latest period it sees). Rows with no committed_at (a
// severed-era birth, which carries only a date window, not an exact date —
// see severedRange in ../../lib/history.ts) can't be placed on a time axis,
// so they're excluded.
//
// commit: one row per commit (grouped by commit_seq, the ordering column
// shared with the reconstructed pre-git eras — see gitCommitSeq in
// history-db.ts) that has at least one matching edit. No zero-fill: an
// absent commit_seq is a real commit that touched no atlas content, not a
// gap in a continuous axis.
//
// Same strict "modified" predicate as mod-counts.ts (COUNTED) in all three
// modes: only `change_type = 'content'` rows, and of those only semantic
// edits (or, for rows with no change_kind yet, a real stored diff) — see
// that file's header for the full rationale.
import { sql } from "../db.ts";
import { toIsoDate } from "./history.ts";

type TimelineGranularity = "month" | "week" | "commit";

interface PeriodQueryRow {
  period: string;
  count: number;
}

interface CommitQueryRow {
  seq: number;
  sha: string;
  date: string | Date | null;
  count: number;
}

const COUNTED = `change_kind = 'semantic'
                 OR (change_kind IS NULL AND diff IS NOT NULL)`;

function parseGranularity(req: Request): TimelineGranularity {
  const g = new URL(req.url).searchParams.get("granularity");
  return g === "week" || g === "commit" ? g : "month";
}

export async function handleModTimeline(req: Request): Promise<Response> {
  const granularity = parseGranularity(req);
  try {
    if (granularity === "commit") {
      // ::int — COUNT is bigint, which Bun.sql may surface as a string.
      const rows = (await sql.unsafe(`
        SELECT commit_seq AS seq, commit_sha AS sha, MIN(committed_at) AS date,
               COUNT(*)::int AS count
        FROM atlas_history
        WHERE change_type = 'content' AND commit_seq IS NOT NULL AND (${COUNTED})
        GROUP BY commit_seq, commit_sha
        ORDER BY commit_seq
      `)) as CommitQueryRow[];
      return Response.json(
        rows.map((r) => ({ seq: r.seq, sha: r.sha, date: r.date ? toIsoDate(r.date) : null, count: r.count })),
        { headers: { "Cache-Control": "public, max-age=300" } },
      );
    }
    // Only "month"/"week" ever reach here (parseGranularity's fallback), both
    // hardcoded literals below — never the raw query string.
    const trunc = granularity === "week" ? "week" : "month";
    const fmt = granularity === "week" ? "YYYY-MM-DD" : "YYYY-MM";
    const rows = (await sql.unsafe(`
      SELECT to_char(date_trunc('${trunc}', committed_at), '${fmt}') AS period,
             COUNT(*)::int AS count
      FROM atlas_history
      WHERE change_type = 'content' AND committed_at IS NOT NULL AND (${COUNTED})
      GROUP BY period
      ORDER BY period
    `)) as PeriodQueryRow[];
    return Response.json(
      rows.map((r) => ({ period: r.period, count: r.count })),
      { headers: { "Cache-Control": "public, max-age=300" } },
    );
  } catch {
    return new Response(null, { status: 503 });
  }
}
