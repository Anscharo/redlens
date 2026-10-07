// Types for `atlas_history` events and rows. Pure: no database, no imports beyond types.
import type { DiffLine } from "../../lib/history.ts";

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
