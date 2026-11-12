// Shared write path for the `atlas_history` table: turn per-node history events
// (the shape build-history.mjs produces) into rows and upsert them with a
// proper jsonb `diff`. The sole place that knows how to write atlas_history —
// build-history.mjs imports this for its direct-to-DB sink.
import type { SQL } from "bun";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { config } from "../config.ts";
import { type HistoryInsert } from "./history-rows.ts";
import type { ChangeType } from "../../lib/changeTypes.ts";
import { prRowsFromHistory, upsertAtlasPrs } from "./history-prs.ts";

export { stampMigrationSeam } from "./history-seam.ts";
export { upsertAtlasPrs, type AtlasPrInsert } from "./history-prs.ts";

export { eventToRow, htmlEraRows, preEraRows, type HistoryEvent } from "./history-rows.ts";
export type { HistoryInsert };

// A "modified" row is strict: change_kind = 'semantic', or — for rows with no
// change_kind yet (reconstructed-era rows, or markdown-era rows written before
// migration 006's `pnpm build:history --full` backfill reached them) — a real
// stored diff, so an un-backfilled edit undercounts instead of reading as
// "never modified". Shared by mod-counts.ts and mod-timeline.ts so the two
// endpoints' definition of "modified" can't drift apart.
export const COUNTED_CONTENT_EDIT = `change_kind = 'semantic'
                 OR (change_kind IS NULL AND diff IS NOT NULL)`;

export const HISTORY_COLS = [
  "doc_id", "commit_sha", "committed_at", "commit_seq", "pr_number", "pr_title", "pr_url",
  "pr_author", "summary", "description", "moved_from", "moved_to", "change_type", "diff",
  "change_kind", "review_count", "approval_count", "comment_count",
  // HTML-era additive columns (migration 009 / plan §7); null for the markdown era.
  "era", "seam", "extracted_from", "merged_into", "move_kind",
  // Per-change provenance (migration 010 / plan §10.4); null unless an ai/human link.
  "method",
  // Pre-git origin link (migration 011 / docs/plans/pre-git-history.md); null unless
  // era is mip/genesis — the mips-repo section URL or the genesis IPFS gateway URL.
  "source_url",
] as const;

/** Topological commit order (oldest = 1) of the atlas submodule, keyed by the
 *  7-char short sha that history events carry. commit_seq drives the read-side
 *  `ORDER BY` and the incremental cursor (MAX(commit_seq)). */
export function gitCommitSeq(): Map<string, number> {
  try {
    const out = execFileSync("git", ["log", "--reverse", "--format=%H"], {
      cwd: join(config.root, "vendor/next-gen-atlas"),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 100 * 1024 * 1024,
    });
    const m = new Map<string, number>();
    out.trim().split("\n").forEach((h, i) => h && m.set(h.slice(0, 7), i + 1));
    return m;
  } catch {
    return new Map();
  }
}

const SET_CLAUSE = HISTORY_COLS.filter((c) => c !== "doc_id" && c !== "commit_sha" && c !== "change_type")
  .map((c) => `${c} = excluded.${c}`)
  .join(", ");

/** Upsert rows in chunks. `diff` carries an explicit `$N::jsonb` cast with the
 *  RAW array passed through — Bun.sql JSON-encodes it once. Pre-stringifying
 *  double-encodes into a jsonb string scalar that reads back as a string and
 *  crashes the diff renderer (the bug this whole path was built to avoid). */
export async function upsertHistory(sql: SQL, rows: HistoryInsert[], chunkSize = 1000): Promise<void> {
  await upsertAtlasPrs(sql, prRowsFromHistory(rows), chunkSize);
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const params: unknown[] = [];
    const valuesSql = chunk
      .map((r) => {
        const ph = HISTORY_COLS.map((c) => {
          params.push(r[c]);
          return c === "diff" ? `$${params.length}::jsonb` : `$${params.length}`;
        });
        return `(${ph.join(",")})`;
      })
      .join(",");
    await sql.unsafe(
      `INSERT INTO atlas_history (${HISTORY_COLS.join(",")}) VALUES ${valuesSql}
       ON CONFLICT (doc_id, commit_sha, change_type) DO UPDATE SET ${SET_CLAUSE}`,
      params,
    );
  }
}

/** The incremental cursor: the short sha of the newest row already in the DB
 *  (highest commit_seq). build-history resumes its git walk after this commit. */
export async function readHistoryCursor(sql: SQL): Promise<string | null> {
  try {
    const rows = await sql<{ commit_sha: string }[]>`
      SELECT commit_sha FROM atlas_history
      WHERE commit_seq = (SELECT MAX(commit_seq) FROM atlas_history WHERE commit_seq IS NOT NULL)
      LIMIT 1
    `;
    return rows[0]?.commit_sha ?? null;
  } catch {
    return null;
  }
}

/** The change types history-events.ts added after most databases were written:
 *  a retitling, a renumbering and a `[Type]` change. */
export const BACKFILLED_CHANGE_TYPES: readonly ChangeType[] = ["retitled", "renumbered", "retyped"];

/** Whether this database holds any row of those types. A database whose cursor
 *  predates them holds none, and build-history walks the whole log once to add
 *  them. A failed read says yes, so it never triggers that walk. */
export async function hasBackfilledRows(sql: SQL): Promise<boolean> {
  try {
    const rows = await sql<{ one: number }[]>`
      SELECT 1 AS one FROM atlas_history WHERE change_type IN ${sql([...BACKFILLED_CHANGE_TYPES])} LIMIT 1
    `;
    return rows.length > 0;
  } catch {
    return true;
  }
}
