// Shared write path for the `atlas_history` table: turn per-node history events
// (the shape build-history.mjs produces) into rows and upsert them with a
// proper jsonb `diff`. The sole place that knows how to write atlas_history —
// build-history.mjs imports this for its direct-to-DB sink.
import type { SQL } from "bun";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { DiffLine } from "../../lib/history.ts";
import { config } from "../config.ts";

// chatbot-plan vocabulary: the frontend uses modified/moved; Postgres stores
// content/structural. added/removed pass through unchanged.
export const CHANGE_TYPE_MAP: Record<string, string> = { modified: "content", moved: "structural" };

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
  // HTML-era additive fields (plan §7); absent for markdown-era events.
  era?: string;
  seam?: string;
  extractedFrom?: string;
  mergedInto?: string;
  moveKind?: string;
  // Per-change provenance (plan §10.4): "ai" | "human" on a reconstructed link; else absent.
  method?: string;
  // Pre-git origin events only (docs/plans/pre-git-history.md): the event's baked
  // negative ordering position (mip/genesis/severed reserved blocks) and its external
  // source link (mips-repo section / genesis IPFS gateway). Absent for git-derived eras,
  // whose commit_seq is always looked up fresh via seqByCommit.
  commitSeq?: number;
  sourceUrl?: string;
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
  era: string | null;
  seam: string | null;
  extracted_from: string | null;
  merged_into: string | null;
  move_kind: string | null;
  method: string | null;
  source_url: string | null;
}

export interface AtlasPrInsert {
  pr_number: number;
  title: string | null;
  url: string | null;
  author: string | null;
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
    // git shas resolve through the log-derived map (authoritative); a synthetic
    // (non-git) sha — html-era tombstones, pre-git mip/genesis/severed events — isn't
    // in that map, so fall back to the event's own baked seq instead of nulling it out.
    // Nulling here would silently discard the whole negative-seq ordering design at
    // ingestion (docs/plans/pre-git-history.md, Gate 3).
    commit_seq: seqByCommit.get(e.commitHash) ?? e.commitSeq ?? null,
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
    era: e.era ?? null,
    seam: e.seam ?? null,
    extracted_from: e.extractedFrom ?? null,
    merged_into: e.mergedInto ?? null,
    move_kind: e.moveKind ?? null,
    method: e.method ?? null,
    source_url: e.sourceUrl ?? null,
  };
}

/** Map the frozen HTML-era artifact (public/history-html-era.json) to upsertable
 *  rows (plan §5/§7.1). Each event already carries the HistoryEvent shape + a
 *  `docId`; commit_seq is reconciled by SHA via `seqByCommit` (gitCommitSeq), so
 *  the baked artifact seq is never trusted. Null events (missing natural key) are
 *  dropped. The rows go straight into `upsertHistory`. */
export function htmlEraRows(
  artifact: { events: Array<HistoryEvent & { docId: string }> },
  seqByCommit: Map<string, number>,
): HistoryInsert[] {
  const rows: HistoryInsert[] = [];
  for (const e of artifact.events) {
    const row = eventToRow(e.docId, e, seqByCommit);
    if (row) rows.push(row);
  }
  return rows;
}

/** Map the frozen pre-git artifact (public/history-pre-era.json — docs/plans/
 *  pre-git-history.md) to upsertable rows. Every event's `commitHash` is a synthetic
 *  tag (`mip:<n>:<sec>`, `genesis:bafkreih7…`, `severed:…`), never a real git sha, so
 *  its baked `commitSeq` (a reserved negative block) is what eventToRow falls back to —
 *  there is nothing to reconcile against seqByCommit, unlike htmlEraRows. Same shape,
 *  separate name per the plan's "ordering / storage" design (kept distinct from
 *  htmlEraRows so a future divergence in either doesn't silently affect the other). */
export function preEraRows(
  artifact: { events: Array<HistoryEvent & { docId: string }> },
  seqByCommit: Map<string, number>,
): HistoryInsert[] {
  const rows: HistoryInsert[] = [];
  for (const e of artifact.events) {
    const row = eventToRow(e.docId, e, seqByCommit);
    if (row) rows.push(row);
  }
  return rows;
}

/** The HTML→markdown migration (PR #117). build-history re-tags every doc's birth at
 *  this commit as `moved` (they existed in the HTML era), which Postgres stores as
 *  `structural` — so this is the one row every doc alive at the seam is guaranteed to
 *  have, and the only place to hang a per-doc seam verdict that has no event of its own. */
const MIGRATION_COMMIT = "22cc27b5";
const MIGRATION_CHANGE_TYPE = "structural";

/**
 * Stamp each doc's #117 seam verdict (`kept` / `split` / `merged` / `reintroduced` /
 * `untraced` / `created`) onto its migration row, from the frozen artifact's `docMeta`.
 *
 * Not done in build-history's git walk on purpose: that walk is incremental and will
 * never re-visit #117 again, so a verdict written there would only reach the DB on a
 * `--full` rebuild. docMeta rides the html-era upsert instead, which runs on every sync.
 *
 * The verdict can't come from the event stream either — the docs that most need it
 * (`untraced`, `created`) have NO html-era events at all; docMeta is the only record
 * that they were looked at and not threaded.
 */
export async function stampMigrationSeam(
  sql: SQL,
  artifact: {
    meta?: { migrationCommit?: string };
    docMeta?: Record<string, { seam?: string; extractedFrom?: string }>;
  },
  chunkSize = 1000,
): Promise<number> {
  const sha = (artifact.meta?.migrationCommit ?? MIGRATION_COMMIT).slice(0, 7);
  const entries = Object.entries(artifact.docMeta ?? {}).filter(([, m]) => m?.seam);
  let stamped = 0;
  for (let i = 0; i < entries.length; i += chunkSize) {
    const params: unknown[] = [sha];
    const values = entries
      .slice(i, i + chunkSize)
      .map(([id, m]) => {
        params.push(id, m.seam, m.extractedFrom ?? null);
        return `($${params.length - 2}::uuid, $${params.length - 1}, $${params.length}::uuid)`;
      })
      .join(",");
    // extracted_from rides along: a `split` doc with no reconstructed event of its own
    // (34 in the committed artifact) has its source-document pointer ONLY in docMeta, so
    // without this the lineage the reconstruction recovered never reaches the DB. COALESCE
    // so a doc whose own event already carried the pointer is never blanked by a docMeta
    // row that lacks one.
    const res = await sql.unsafe(
      `UPDATE atlas_history h SET seam = v.seam, extracted_from = COALESCE(v.extracted_from, h.extracted_from)
       FROM (VALUES ${values}) AS v(doc_id, seam, extracted_from)
       WHERE h.doc_id = v.doc_id AND h.commit_sha = $1 AND h.change_type = '${MIGRATION_CHANGE_TYPE}'`,
      params,
    );
    stamped += res.count ?? 0;
  }
  // Everything else alive at the seam: docs the reconstruction has no docMeta row for
  // at all. "No verdict" and "untraced" mean the same thing to a reader, and leaving
  // NULL would make the reader unable to tell them apart from an un-synced row.
  const rest = await sql.unsafe(
    `UPDATE atlas_history SET seam = 'untraced'
     WHERE commit_sha = $1 AND change_type = '${MIGRATION_CHANGE_TYPE}' AND seam IS NULL`,
    [sha],
  );
  return stamped + (rest.count ?? 0);
}

const SET_CLAUSE = HISTORY_COLS.filter((c) => c !== "doc_id" && c !== "commit_sha" && c !== "change_type")
  .map((c) => `${c} = excluded.${c}`)
  .join(", ");

function prRowsFromHistory(rows: HistoryInsert[]): AtlasPrInsert[] {
  const byPr = new Map<number, AtlasPrInsert>();
  for (const row of rows) {
    if (row.pr_number == null) continue;
    const existing = byPr.get(row.pr_number);
    byPr.set(row.pr_number, {
      pr_number: row.pr_number,
      title: row.pr_title ?? existing?.title ?? null,
      url: row.pr_url ?? existing?.url ?? null,
      author: row.pr_author ?? existing?.author ?? null,
      review_count: row.review_count ?? existing?.review_count ?? null,
      approval_count: row.approval_count ?? existing?.approval_count ?? null,
      comment_count: row.comment_count ?? existing?.comment_count ?? null,
    });
  }
  return [...byPr.values()];
}

export async function upsertAtlasPrs(sql: SQL, rows: AtlasPrInsert[], chunkSize = 1000): Promise<void> {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const params: unknown[] = [];
    const valuesSql = chunk
      .map((r) => {
        const cols = [
          r.pr_number,
          r.title,
          r.url,
          r.author,
          r.review_count,
          r.approval_count,
          r.comment_count,
        ];
        const ph = cols.map((value) => {
          params.push(value);
          return `$${params.length}`;
        });
        return `(${ph.join(",")})`;
      })
      .join(",");
    await sql.unsafe(
      `INSERT INTO atlas_prs (pr_number, title, url, author, review_count, approval_count, comment_count)
       VALUES ${valuesSql}
       ON CONFLICT (pr_number) DO UPDATE SET
         title = COALESCE(excluded.title, atlas_prs.title),
         url = COALESCE(excluded.url, atlas_prs.url),
         author = COALESCE(excluded.author, atlas_prs.author),
         review_count = COALESCE(excluded.review_count, atlas_prs.review_count),
         approval_count = COALESCE(excluded.approval_count, atlas_prs.approval_count),
         comment_count = COALESCE(excluded.comment_count, atlas_prs.comment_count),
         updated_at = now()`,
      params,
    );
  }
}

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
