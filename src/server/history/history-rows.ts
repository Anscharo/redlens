// Event→row mappers for the `atlas_history` table. Pure: no database,
// so the era artifacts can be mapped without a connection. history-db.ts re-exports
// these and owns the SQL.
import { pgType } from "./change-type.ts";
import type { HistoryEvent, HistoryInsert } from "./history-row-types.ts";

export type { HistoryEvent, HistoryInsert };

type PrFields = Pick<
  HistoryInsert,
  "pr_number" | "pr_title" | "pr_url" | "pr_author" | "review_count" | "approval_count" | "comment_count"
>;
type ChangeFields = Pick<
  HistoryInsert,
  "summary" | "description" | "moved_from" | "moved_to" | "change_type" | "diff" | "change_kind"
>;
type ProvenanceFields = Pick<
  HistoryInsert,
  "era" | "seam" | "extracted_from" | "merged_into" | "move_kind" | "method" | "source_url"
>;

function prFields(e: HistoryEvent): PrFields {
  return {
    pr_number: e.pr ?? null,
    pr_title: e.prTitle ?? null,
    pr_url: e.prUrl ?? null,
    pr_author: e.prAuthor ?? null,
    review_count: e.reviewCount ?? null,
    approval_count: e.approvalCount ?? null,
    comment_count: e.commentCount ?? null,
  };
}

function changeFields(e: HistoryEvent, changeType: string): ChangeFields {
  return {
    summary: e.summary ?? null,
    description: e.description ?? null,
    moved_from: e.movedFrom ?? null,
    moved_to: e.movedTo ?? null,
    change_type: pgType(changeType),
    diff: e.diff ?? null,
    change_kind: e.changeKind ?? null,
  };
}

function provenanceFields(e: HistoryEvent): ProvenanceFields {
  return {
    era: e.era ?? null,
    seam: e.seam ?? null,
    extracted_from: e.extractedFrom ?? null,
    merged_into: e.mergedInto ?? null,
    move_kind: e.moveKind ?? null,
    method: e.method ?? null,
    source_url: e.sourceUrl ?? null,
  };
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
    ...prFields(e),
    ...changeFields(e, e.changeType),
    ...provenanceFields(e),
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
