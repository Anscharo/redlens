// Shared write path for the `atlas_history` table: turn per-node history events
// (the shape build-history.mjs produces) into rows and upsert them with a
// proper jsonb `diff`. The sole place that knows how to write atlas_history —
// build-history.mjs imports this for its direct-to-DB sink.
import type { SQL } from "bun";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { DiffLine } from "../lib/history.ts";
import { config } from "./config.ts";

// chatbot-plan vocabulary: the frontend uses modified/moved; Postgres stores
// content/structural. added/removed pass through unchanged.
export const CHANGE_TYPE_MAP: Record<string, string> = { modified: "content", moved: "structural" };

export const HISTORY_COLS = [
  "doc_id", "commit_sha", "committed_at", "commit_seq", "pr_number", "pr_title", "pr_url",
  "pr_author", "summary", "description", "moved_from", "moved_to", "change_type", "diff",
  "change_kind", "review_count", "approval_count", "comment_count",
] as const;

/** A single history entry as emitted by build-history.mjs (also the on-disk
 *  `public/history/<uuid>.json` array element). */
export interface HistoryEvent {
  date?: string;
  commitHash?: string;
  changeType?: string;
  pr?: number;
  prTitle?: string;
  prUrl?: string;
  prAuthor?: string;
  summary?: string;
  description?: string;
  movedFrom?: string;
  movedTo?: string;
  diff?: DiffLine[];
  changeKind?: string;
  reviewCount?: number;
  approvalCount?: number;
  commentCount?: number;
}

/** One row to upsert into atlas_history. */
export interface HistoryInsert {
  doc_id: string;
  commit_sha: string;
  committed_at: string | null;
  commit_seq: number | null;
  pr_number: number | null;
  pr_title: string | null;
  pr_url: string | null;
  pr_author: string | null;
  summary: string | null;
  description: string | null;
  moved_from: string | null;
  moved_to: string | null;
  change_type: string;
  diff: DiffLine[] | null;
  change_kind: string | null;
  review_count: number | null;
  approval_count: number | null;
  comment_count: number | null;
}

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

/** Map a history event to a row, or null if it lacks the natural-key fields. */
export function eventToRow(
  docId: string,
  e: HistoryEvent,
  seqByCommit: Map<string, number>,
): HistoryInsert | null {
  if (!e.commitHash || !e.changeType) return null;
  return {
    doc_id: docId,
    commit_sha: e.commitHash,
    committed_at: e.date ?? null,
    commit_seq: seqByCommit.get(e.commitHash) ?? null,
    pr_number: e.pr ?? null,
    pr_title: e.prTitle ?? null,
    pr_url: e.prUrl ?? null,
    pr_author: e.prAuthor ?? null,
    summary: e.summary ?? null,
    description: e.description ?? null,
    moved_from: e.movedFrom ?? null,
    moved_to: e.movedTo ?? null,
    change_type: CHANGE_TYPE_MAP[e.changeType] ?? e.changeType,
    diff: e.diff ?? null,
    change_kind: e.changeKind ?? null,
    review_count: e.reviewCount ?? null,
    approval_count: e.approvalCount ?? null,
    comment_count: e.commentCount ?? null,
  };
}

const SET_CLAUSE = HISTORY_COLS.filter((c) => c !== "doc_id" && c !== "commit_sha" && c !== "change_type")
  .map((c) => `${c} = excluded.${c}`)
  .join(", ");

/** Upsert rows in chunks. `diff` carries an explicit `$N::jsonb` cast with the
 *  RAW array passed through — Bun.sql JSON-encodes it once. Pre-stringifying
 *  double-encodes into a jsonb string scalar that reads back as a string and
 *  crashes the diff renderer (the bug this whole path was built to avoid). */
export async function upsertHistory(sql: SQL, rows: HistoryInsert[], chunkSize = 1000): Promise<void> {
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
