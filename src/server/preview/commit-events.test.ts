// What a branch commit's rows say: the live engine's events, plus renumbering
// and the merge-commit rule. Run via `bun test`.

import { describe, expect, test } from "bun:test";

import { makeNodeEntry, type GitSnapshot } from "../../../scripts/lib/atlas-git-parse.ts";
import { commitEntries, mergeEntries } from "./commit-events.ts";

type Doc = [id: string, docNo: string, body: string, title?: string];
const snap = (...docs: Doc[]): GitSnapshot =>
  new Map(docs.map(([id, docNo, body, title = `T${id}`]) => [id, makeNodeEntry(docNo, title, "Core", body, "content/A.md")]));

describe("commitEntries", () => {
  test("adds, edits, removes, and reports a renumbering as its own row", () => {
    const prev = snap(["a", "A.1", "same"], ["b", "A.2", "old"], ["c", "A.3", "gone"], ["r", "A.4", "kept"]);
    const curr = snap(["a", "A.1", "same"], ["b", "A.2", "new"], ["d", "A.9", "fresh"], ["r", "A.5", "kept"]);
    const rows = commitEntries(prev, curr);
    expect(Object.keys(rows).sort()).toEqual(["b", "c", "d", "r"]);
    expect(rows.d[0]).toMatchObject({ changeType: "added", docNo: "A.9", diff: [["+", "fresh"]] });
    expect(rows.b[0].changeType).toBe("modified");
    expect(rows.b[0].diff!.length).toBeGreaterThan(0);
    expect(rows.c[0]).toMatchObject({ changeType: "removed", diff: [["-", "gone"]] });
    expect(rows.r).toEqual([{ changeType: "renumbered", docNo: "A.5", title: "Tr", prevDocNo: "A.4" }]);
  });

  test("a retitle carries the old title; an unchanged commit has no rows", () => {
    const prev = snap(["a", "A.1", "body", "Old"]);
    expect(commitEntries(prev, snap(["a", "A.1", "body", "New"])).a[0]).toMatchObject({ changeType: "modified", title: "New", prevTitle: "Old" });
    expect(commitEntries(prev, prev)).toEqual({});
  });
});

describe("mergeEntries", () => {
  const ours = snap(["a", "A.1", "one EDIT"], ["b", "A.2", "two"]);
  const theirs = snap(["a", "A.1", "one"], ["b", "A.2", "two UPSTREAM"]);

  test("a clean merge has no rows: every document matches one parent", () => {
    const merged = snap(["a", "A.1", "one EDIT"], ["b", "A.2", "two UPSTREAM"]);
    expect(mergeEntries([ours, theirs], merged)).toEqual({});
  });

  test("a document both sides edited is reported against the first parent and flagged", () => {
    const merged = snap(["a", "A.1", "one RESOLVED"], ["b", "A.2", "two UPSTREAM"]);
    const rows = mergeEntries([ours, theirs], merged);
    expect(Object.keys(rows)).toEqual(["a"]);
    expect(rows.a[0]).toMatchObject({ changeType: "modified", bothSides: true });
  });
});
