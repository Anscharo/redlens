import type { PreviewCommitError, PreviewCommitRow, PreviewCommitsState } from "@/lib/previewCommits";

const CHANGE_WORD: Record<PreviewCommitRow["changeType"], string> = {
  added: "added",
  modified: "edited",
  removed: "removed",
  moved: "moved",
  renumbered: "renumbered",
};

/** One row's change line, as the live history words it plus what a branch adds. */
export function commitRowLabel(row: PreviewCommitRow): string {
  const parts = [CHANGE_WORD[row.changeType]];
  if (row.changeType === "modified" && row.changeKind && row.changeKind !== "semantic") parts[0] += ` (${row.changeKind})`;
  if (row.changeType === "renumbered" && row.prevDocNo) parts[0] += ` ${row.prevDocNo} → ${row.docNo}`;
  if (row.changeType === "moved" && row.movedTo) parts[0] += `${row.movedFrom ? ` from ${row.movedFrom}` : ""} to ${row.movedTo}`;
  if (row.prevTitle) parts.push(`retitled from “${row.prevTitle}”`);
  if (row.bothSides) parts.push("both sides' edits met here");
  return parts.join(" · ");
}

const ERROR_NOTE: Record<PreviewCommitError, string> = {
  unavailable: "No commit history for this diff base: the branch has no merge base with it.",
  "range-failed": "Couldn't list this branch's commits from GitHub.",
  "fetch-failed": "Couldn't fetch this branch's commits from GitHub.",
  timeout: "Reading this branch's commits took too long.",
  failed: "Commit history failed to load.",
  "rate-limited": "Too many requests for commit history; try again shortly.",
};

/** What the list says once the stream is over; null while it runs. `changed`
 *  is whether the branch's overall diff touches this document. */
export function commitsEndNote(s: PreviewCommitsState, changed: boolean): string | null {
  if (s.phase === "error") return ERROR_NOTE[s.error ?? "failed"];
  if (s.phase !== "done") return null;
  const touching = s.commits.filter((c) => c.entries.length > 0).length;
  const scope = s.truncated ? `Showing the newest ${s.commits.length} of ${s.total} commits. ` : "";
  if (touching === 0) return scope ? `${scope}None of them touched this doc.` : "No commit in this branch touched this doc.";
  if (!changed) return `${scope}Touched by ${touching} commit${touching === 1 ? "" : "s"}, no net change.`;
  return scope.trim() || null;
}
