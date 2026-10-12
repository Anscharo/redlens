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

/** What the list says once the stream is over; null while it runs. It always
 *  says how many of the branch's commits touched this document, since the
 *  list shows only those and the progress bar counted every commit. `changed`
 *  is whether the branch's overall diff touches this document. */
export function commitsEndNote(s: PreviewCommitsState, changed: boolean): string | null {
  if (s.phase === "error") return ERROR_NOTE[s.error ?? "failed"];
  if (s.phase !== "done") return null;
  const touching = s.commits.filter((c) => c.entries.length > 0).length;
  const n = s.commits.length;
  const end = changed ? "." : ", with no net change.";
  if (s.truncated) {
    const scope = `Showing the newest ${n} of ${s.total} commits.`;
    return touching === 0 ? `${scope} None of them touched this doc.` : `${scope} ${touching} of them touched this doc${end}`;
  }
  if (touching === 0) return "No commit in this branch touched this doc.";
  return `${touching} of ${n} commit${n === 1 ? "" : "s"} in this branch touched this doc${end}`;
}
