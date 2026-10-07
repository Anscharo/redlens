// Row types and event→row mappers for the `atlas_history` table. Pure: no database,
// so the era artifacts can be mapped without a connection. history-db.ts re-exports
// these and owns the SQL.
import type { DiffLine } from "../../lib/history.ts";
import { pgType } from "./change-type.ts";

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
    change_type: pgType(e.changeType),
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

/** Rows from a frozen era artifact. Each event carries the HistoryEvent shape plus a
 *  `docId`; events missing the natural key are dropped. */
function rowsFromArtifact(
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

/** Map the frozen HTML-era artifact (public/history-html-era.json) to upsertable
 *  rows. commit_seq is reconciled by SHA via `seqByCommit` (gitCommitSeq), so the
 *  baked artifact seq is never trusted. */
export const htmlEraRows = rowsFromArtifact;

/** Map the frozen pre-git artifact (public/history-pre-era.json) to upsertable
 *  rows. Every `commitHash` is a synthetic tag (`mip:<n>:<sec>`, `genesis:bafkreih7…`,
 *  `severed:…`), never a git sha, so the baked `commitSeq` (a reserved negative
 *  block) is what eventToRow falls back to. */
export const preEraRows = rowsFromArtifact;
