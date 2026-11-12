// foldRenumberMoves: an atomized-era move that only restates a renumbering is dropped.
import { describe, expect, it } from "vitest";

import { foldRenumberMoves, type HistoryEntry } from "./history";

const e = (changeType: HistoryEntry["changeType"], commitHash: string, movedFrom?: string, movedTo?: string): HistoryEntry => ({
  date: "2026-01-01",
  commitHash,
  changeType,
  movedFrom,
  movedTo,
});

describe("foldRenumberMoves", () => {
  it("drops the file move that spells out the same renumbering", () => {
    const entries = [
      e("moved", "c1", "content/A/1/9/1/document.md", "content/A/1/10/1/document.md"),
      e("renumbered", "c1", "A.1.9.1", "A.1.10.1"),
    ];
    expect(foldRenumberMoves(entries).map((x) => x.changeType)).toEqual(["renumbered"]);
  });

  it("keeps a move to another file, a move in another commit, and every other entry", () => {
    const entries = [
      e("moved", "c1", "content/A.1.md", "content/A.2.md"),
      e("renumbered", "c1", "A.1.3", "A.2.1"),
      e("moved", "c2", "content/A/1/3/document.md", "content/A/1/4/document.md"),
      e("modified", "c1"),
    ];
    expect(foldRenumberMoves(entries)).toHaveLength(4);
  });
});
