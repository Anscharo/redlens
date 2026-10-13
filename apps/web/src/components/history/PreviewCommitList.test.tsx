// @vitest-environment jsdom
// PreviewCommitList renders a commit stream's state: the progress bar while it
// runs, the commits that touched the document (merges as markers between
// them), and the end note once it is over.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { INITIAL_COMMITS, type PreviewCommit, type PreviewCommitsState } from "@/lib/previewCommits";
import { PreviewCommitList } from "./PreviewCommitList";

afterEach(cleanup);

const commit = (sha: string, over: Partial<PreviewCommit> = {}): PreviewCommit => ({
  sha: sha.padEnd(40, "0"),
  parents: [],
  date: "2026-10-07T12:00:00Z",
  author: "bob",
  message: `subject ${sha}`,
  merge: false,
  entries: [],
  ...over,
});
const RENUMBER = { changeType: "renumbered" as const, docNo: "A.1.3", title: "T", prevDocNo: "A.1.2" };
const state = (over: Partial<PreviewCommitsState>): PreviewCommitsState => ({ ...INITIAL_COMMITS, ...over });
const list = (s: PreviewCommitsState, changed = true) => render(<PreviewCommitList state={s} changed={changed} repo="o/r" />);

describe("PreviewCommitList", () => {
  it("is indeterminate while the branch is fetched, then counts commits as they arrive", () => {
    const { rerender } = list(state({ phase: "fetching", walking: 2, total: 2 }));
    expect(screen.getByLabelText("Commit history")).not.toHaveAttribute("value");
    expect(screen.getByRole("status")).toHaveTextContent("fetching 2 commits");
    rerender(<PreviewCommitList state={state({ phase: "walking", walking: 2, total: 2, commits: [commit("c2")] })} changed repo="o/r" />);
    expect(screen.getByLabelText("Commit history")).toHaveAttribute("value", "1");
    expect(screen.getByRole("status")).toHaveTextContent("reading commits 1 / 2");
  });

  it("shows the commits that touched the doc, with merges as markers, and hides the rest", () => {
    const touched = commit("a1b2c3d", { entries: [RENUMBER] });
    list(state({ phase: "done", commits: [touched, commit("merge01", { merge: true, message: "Merge main" }), commit("quiet01")] }));
    expect(screen.queryByLabelText("Commit history")).toBeNull();
    expect(screen.getByRole("link", { name: "a1b2c3d" })).toHaveAttribute("href", `https://github.com/o/r/commit/${touched.sha}`);
    expect(screen.getByText("2026-10-07")).toBeInTheDocument();
    expect(screen.getByText("subject a1b2c3d")).toBeInTheDocument();
    expect(screen.getByText("renumbered A.1.2 → A.1.3")).toBeInTheDocument();
    expect(screen.getByText("Merge main").closest("article")).toHaveAttribute("data-merge", "true");
    expect(screen.queryByText("subject quiet01")).toBeNull();
    expect(screen.getByText("1 of 3 commits in this branch touched this doc.")).toBeInTheDocument();
  });

  it("a branch whose commits never touched the doc shows only the end note", () => {
    list(state({ phase: "done", commits: [commit("m1", { merge: true }), commit("c1")] }), false);
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    expect(screen.getByText("No commit in this branch touched this doc.")).toBeInTheDocument();
  });

  it("says when commits touched the doc but changed nothing overall", () => {
    list(state({ phase: "done", commits: [commit("c2", { entries: [RENUMBER] }), commit("c1", { entries: [RENUMBER] })] }), false);
    expect(screen.getByText("2 of 2 commits in this branch touched this doc, with no net change.")).toBeInTheDocument();
  });

  it("names why the history could not be read", () => {
    list(state({ phase: "error", error: "fetch-failed" }));
    expect(screen.getByText("Couldn't fetch this branch's commits from GitHub.")).toBeInTheDocument();
  });
});
