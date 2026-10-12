// The words a preview commit row and the list's end note use.

import { describe, it, expect } from "vitest";

import { INITIAL_COMMITS, type PreviewCommit, type PreviewCommitsState } from "@/lib/previewCommits";
import { commitRowLabel, commitsEndNote } from "./previewCommitCopy";

const commit = (touched: boolean): PreviewCommit => ({
  sha: "s",
  parents: [],
  date: "d",
  author: null,
  message: "m",
  merge: false,
  entries: touched ? [{ changeType: "added", docNo: "A.1", title: "T" }] : [],
});
const done = (commits: PreviewCommit[], over: Partial<PreviewCommitsState> = {}): PreviewCommitsState => ({ ...INITIAL_COMMITS, phase: "done", commits, ...over });

describe("commitRowLabel", () => {
  it("words each change as the live history does, plus what a branch adds", () => {
    const row = { docNo: "A.2", title: "T" };
    expect(commitRowLabel({ ...row, changeType: "modified", changeKind: "semantic" })).toBe("edited");
    expect(commitRowLabel({ ...row, changeType: "modified", changeKind: "typo" })).toBe("edited (typo)");
    expect(commitRowLabel({ ...row, changeType: "moved", movedFrom: "a.md", movedTo: "b.md" })).toBe("moved from a.md to b.md");
    expect(commitRowLabel({ ...row, changeType: "renumbered", prevDocNo: "A.1" })).toBe("renumbered A.1 → A.2");
    expect(commitRowLabel({ ...row, changeType: "modified", prevTitle: "Old", bothSides: true })).toBe("edited · retitled from “Old” · both sides' edits met here");
  });
});

describe("commitsEndNote", () => {
  it("says nothing while the stream runs", () => {
    expect(commitsEndNote({ ...INITIAL_COMMITS, phase: "walking" }, true)).toBeNull();
  });

  it("always says how many of the branch's commits touched the doc, since only those are listed", () => {
    expect(commitsEndNote(done([commit(true), commit(false), commit(false)]), true)).toBe("1 of 3 commits in this branch touched this doc.");
    expect(commitsEndNote(done([commit(true)]), true)).toBe("1 of 1 commit in this branch touched this doc.");
  });

  it("names the end states", () => {
    expect(commitsEndNote(done([commit(false)]), true)).toBe("No commit in this branch touched this doc.");
    expect(commitsEndNote(done([commit(true), commit(true)]), false)).toBe("2 of 2 commits in this branch touched this doc, with no net change.");
    expect(commitsEndNote(done([commit(true)], { truncated: true, total: 250 }), true)).toBe("Showing the newest 1 of 250 commits. 1 of them touched this doc.");
    expect(commitsEndNote(done([commit(false)], { truncated: true, total: 250 }), true)).toBe("Showing the newest 1 of 250 commits. None of them touched this doc.");
    expect(commitsEndNote({ ...INITIAL_COMMITS, phase: "error", error: "unavailable" }, true)).toMatch(/no merge base/);
  });
});
