// The wire format of a preview's commit-by-commit history
// (`GET /api/preview/<sha>/commits`, src/server/preview/commit-route.ts), and
// the reader's state as its events arrive. The server's events are typed
// against these declarations, so the two cannot drift.

import type { DiffLine } from "./history";

/** What one commit did to the asked-for document. */
export interface PreviewCommitRow {
  /** A live history change type, or `renumbered`: a new doc number with nothing else changed. */
  changeType: "added" | "modified" | "removed" | "moved" | "renumbered";
  docNo: string;
  title: string;
  prevDocNo?: string;
  prevTitle?: string;
  /** On a merge commit: the merged document matches neither parent. */
  bothSides?: true;
  diff?: DiffLine[];
  changeKind?: string;
  movedFrom?: string;
  movedTo?: string;
}

export interface PreviewCommit {
  sha: string;
  parents: string[];
  /** Author date, ISO 8601. */
  date: string;
  author: string | null;
  /** First line of the commit message. */
  message: string;
  merge: boolean;
  /** Only the asked-for document's rows; empty when the commit left it alone. */
  entries: PreviewCommitRow[];
}

export type PreviewCommitError = "unavailable" | "range-failed" | "fetch-failed" | "timeout" | "failed" | "rate-limited";

export type PreviewCommitEvent =
  | { type: "fetching"; phase?: string; loaded?: number; total?: number }
  | { type: "range"; total: number; walking: number }
  | { type: "commit"; index: number; commit: PreviewCommit }
  | { type: "done"; truncated: boolean }
  | { type: "error"; reason: PreviewCommitError };

export interface PreviewCommitsState {
  /** `connecting` until the first event; `fetching` until the first commit
   *  arrives; `walking` while commits stream in. */
  phase: "connecting" | "fetching" | "walking" | "done" | "error";
  /** Commits on the branch since its diff base. */
  total: number;
  /** How many of the newest of them are read. */
  walking: number;
  /** Newest first. */
  commits: PreviewCommit[];
  truncated: boolean;
  error: PreviewCommitError | null;
}

export const INITIAL_COMMITS: PreviewCommitsState = {
  phase: "connecting",
  total: 0,
  walking: 0,
  commits: [],
  truncated: false,
  error: null,
};

export function reduceCommits(s: PreviewCommitsState, ev: PreviewCommitEvent): PreviewCommitsState {
  switch (ev.type) {
    case "fetching":
      return s.phase === "connecting" ? { ...s, phase: "fetching" } : s;
    case "range":
      return { ...s, phase: s.phase === "connecting" ? "fetching" : s.phase, total: ev.total, walking: ev.walking };
    case "commit":
      return { ...s, phase: "walking", commits: [...s.commits, ev.commit] };
    case "done":
      return { ...s, phase: "done", truncated: ev.truncated };
    case "error":
      return { ...s, phase: "error", error: ev.reason };
  }
}

/** Is the stream over? */
export const commitsSettled = (s: PreviewCommitsState): boolean => s.phase === "done" || s.phase === "error";
