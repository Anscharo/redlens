// foldRestatedEntries: an atomized-era move that only restates a renumbering, and
// an empty edit beside a retitling, are dropped.
import { describe, expect, it } from "vitest";

import { foldRestatedEntries, type HistoryEntry } from "./history";

const e = (changeType: HistoryEntry["changeType"], commitHash: string, movedFrom?: string, movedTo?: string): HistoryEntry => ({
  date: "2026-01-01",
  commitHash,
  changeType,
  movedFrom,
  movedTo,
});

describe("foldRestatedEntries", () => {
  it("drops the file move that spells out the same renumbering", () => {
    const entries = [
      e("moved", "c1", "content/A/1/9/1/document.md", "content/A/1/10/1/document.md"),
      e("renumbered", "c1", "A.1.9.1", "A.1.10.1"),
    ];
    expect(foldRestatedEntries(entries).map((x) => x.changeType)).toEqual(["renumbered"]);
  });

  it("keeps a move to another file, a move in another commit, and every other entry", () => {
    const entries = [
      e("moved", "c1", "content/A.1.md", "content/A.2.md"),
      e("renumbered", "c1", "A.1.3", "A.2.1"),
      e("moved", "c2", "content/A/1/3/document.md", "content/A/1/4/document.md"),
      e("modified", "c1"),
    ];
    expect(foldRestatedEntries(entries)).toHaveLength(4);
  });

  it("drops an edit with no diff beside a same-commit retitling, and keeps an edit with one", () => {
    const entries = [
      e("modified", "c1"),
      e("retitled", "c1", "Old", "New"),
      { ...e("modified", "c2"), diff: [["+", "x"]] } as HistoryEntry,
      e("retitled", "c2", "A", "B"),
      e("modified", "c3"),
    ];
    expect(foldRestatedEntries(entries).map((x) => `${x.changeType}:${x.commitHash}`)).toEqual([
      "retitled:c1",
      "modified:c2",
      "retitled:c2",
      "modified:c3",
    ]);
  });
});
