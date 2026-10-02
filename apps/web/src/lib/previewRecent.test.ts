// mergeRecentPreviews: the two-source merge behind /preview's "my recent
// previews" tab. Pure — BOTH sides are arguments (it reads no storage of its
// own), so no jsdom and no localStorage stubbing here.
import { describe, it, expect } from "vitest";
import { mergeRecentPreviews, mineQuery, type MineRow } from "./previewRecent";

function row(over: Partial<MineRow> & { sha: string }): MineRow {
  return {
    repo: "sky-ecosystem/next-gen-atlas", ref: "pull-1",
    pr_number: 1, pr_title: null, pr_author: null, pr_state: "open",
    doc_count: 0, ...over,
  };
}

describe("mineQuery", () => {
  it("pairs each sha with this browser's open time, keeping the newer of a repeat", () => {
    expect(mineQuery([
      { id: "pull-1", sha: "aaa", at: 100 },
      { id: "pull-1", sha: "aaa", at: 300 },
      { id: "owner:repo:main", sha: "bbb", at: 200 },
    ])).toBe("shas=aaa,bbb&at=300,200");
  });

  it("sends an empty pair when this browser has opened nothing", () => {
    expect(mineQuery([])).toBe("shas=&at=");
  });
});

describe("mergeRecentPreviews", () => {
  it("lists an account row on its own — no local record required", () => {
    const rows = [row({ sha: "aaa", preview_id: "pull-1", opened_at: "2026-09-20T00:00:00Z", pr_title: "T" })];
    expect(mergeRecentPreviews(rows, [])).toEqual([
      {
        id: "pull-1",
        title: "T",
        detail: "0 docs",
        at: Date.parse("2026-09-20T00:00:00Z"),
        private: false,
        prNumber: 1,
        repo: "sky-ecosystem/next-gen-atlas",
        ref: "pull-1",
      },
    ]);
  });

  it("still requires the intersection for a browser-only entry", () => {
    const rows = [row({ sha: "aaa" })];
    // "bbb" is remembered locally but the server didn't confirm it (DB wiped,
    // blocked sha) — it must not leave a dead row in the list.
    const local = [{ id: "pull-1", sha: "aaa", at: 10 }, { id: "pull-2", sha: "bbb", at: 20 }];
    expect(mergeRecentPreviews(rows, local).map((e) => e.id)).toEqual(["pull-1"]);
  });

  it("merges the same id from both sources and lets the NEWER open supply the row", () => {
    const rows = [
      row({ sha: "old", preview_id: "owner:repo:main", opened_at: "2026-09-01T00:00:00Z", pr_title: "Stale", doc_count: 1 }),
      row({ sha: "new", pr_title: "Fresh", doc_count: 9 }),
    ];
    const local = [{ id: "owner:repo:main", sha: "new", at: Date.parse("2026-09-25T00:00:00Z") }];
    // One entry, not two: the branch was pushed, so the local open is newer and
    // its row carries the current title/doc count.
    expect(mergeRecentPreviews(rows, local)).toEqual([
      {
        id: "owner:repo:main",
        title: "Fresh",
        detail: "9 docs",
        at: Date.parse("2026-09-25T00:00:00Z"),
        private: false,
        prNumber: 1,
        repo: "sky-ecosystem/next-gen-atlas",
        ref: "pull-1",
      },
    ]);
  });

  it("sorts newest open first across sources", () => {
    const rows = [
      row({ sha: "a", preview_id: "pull-1", opened_at: "2026-09-01T00:00:00Z" }),
      row({ sha: "b", preview_id: "pull-2", opened_at: "2026-09-27T00:00:00Z" }),
      row({ sha: "c" }),
    ];
    const local = [{ id: "pull-3", sha: "c", at: Date.parse("2026-09-15T00:00:00Z") }];
    expect(mergeRecentPreviews(rows, local).map((e) => e.id)).toEqual(["pull-2", "pull-3", "pull-1"]);
  });

  it("tags a private row and keeps a non-open PR state in the detail", () => {
    const rows = [row({ sha: "a", preview_id: "p", opened_at: "", private: true, pr_author: "amy", pr_state: "merged", doc_count: 4 })];
    const entry = mergeRecentPreviews(rows, [])[0]!;
    expect(entry.detail).toBe("private · by amy · merged · 4 docs");
    // The flag, not just the copy: PreviewPrTabs reads it to withhold the id from analytics.
    expect(entry.private).toBe(true);
  });

  it("carries the PR number and repo the row is rendered from", () => {
    const rows = [row({ sha: "a", preview_id: "blimpa:next-gen-atlas:pull-9", opened_at: "", pr_number: 9, repo: "blimpa/next-gen-atlas" })];
    expect(mergeRecentPreviews(rows, [])[0]).toMatchObject({ prNumber: 9, repo: "blimpa/next-gen-atlas" });
    // A branch preview has no PR; the row falls back to its id for a label.
    const branch = [row({ sha: "b", preview_id: "acme:atlas:main", opened_at: "", pr_number: null, repo: "acme/atlas" })];
    expect(mergeRecentPreviews(branch, [])[0]).toMatchObject({ prNumber: null, repo: "acme/atlas" });
  });

  it("survives an unparseable opened_at rather than dropping the row", () => {
    const rows = [row({ sha: "a", preview_id: "p", opened_at: "not a date" })];
    expect(mergeRecentPreviews(rows, [])).toEqual([
      { id: "p", title: undefined, detail: "0 docs", at: 0, private: false, prNumber: 1, repo: "sky-ecosystem/next-gen-atlas", ref: "pull-1" },
    ]);
  });
});
