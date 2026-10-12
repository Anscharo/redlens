// Per-commit events: what the live history walk and a preview's commit history
// both write for one commit. Pinned here because the two consumers must agree.

import { describe, it, expect } from "vitest";

import { makeNodeEntry, type GitSnapshot } from "./atlas-git-parse.ts";
import { diffSnapshots, eventDiff, snapshotEvents } from "./history-events.ts";

const snap = (...entries: [string, string, string, string?][]): GitSnapshot =>
  new Map(entries.map(([id, docNo, body, p = "content/A.md"]) => [id, makeNodeEntry(docNo, `T ${docNo}`, "Core", body, p)]));

describe("diffSnapshots / snapshotEvents", () => {
  it("lists added, modified, removed and moved, with a renumber-and-edit in two lists", () => {
    const prev = snap(["a", "A.1", "same"], ["b", "A.2", "old"], ["c", "A.3", "gone"]);
    const curr = snap(["a", "A.1", "same"], ["b", "A.2", "new", "content/B.md"], ["d", "A.4", "fresh"]);
    const events = snapshotEvents(diffSnapshots(prev, curr));
    expect(events.map((e) => `${e.changeType}:${e.node.id}`)).toEqual(["added:d", "modified:b", "removed:c", "moved:b"]);
    expect(events[3].node).toMatchObject({ movedFrom: "content/A.md", movedTo: "content/B.md" });
  });

  it("a title change alone is a modification", () => {
    const prev = snap(["a", "A.1", "body"]);
    const curr: GitSnapshot = new Map([["a", { ...prev.get("a")!, title: "Renamed" }]]);
    expect(snapshotEvents(diffSnapshots(prev, curr)).map((e) => e.changeType)).toEqual(["modified"]);
  });
});

describe("eventDiff", () => {
  const prev = snap(["b", "A.2", "keep\nold line"], ["c", "A.3", Array.from({ length: 25 }, (_, i) => `l${i}`).join("\n")]);
  const curr = snap(["b", "A.2", "keep\nnew line"], ["d", "A.4", "fresh"]);
  const ev = (changeType: "added" | "modified" | "removed" | "moved", id: string) => ({
    changeType,
    node: { id, ...(curr.get(id) ?? prev.get(id))!, movedFrom: "x.md", movedTo: "y.md" },
  });

  it("a modification gets a diff and a kind; the hint wins over the classifier", () => {
    const own = eventDiff(ev("modified", "b"), prev, curr, { midHistory: true });
    expect(own.diff!.length).toBeGreaterThan(0);
    expect(own.changeKind).toBeTruthy();
    expect(eventDiff(ev("modified", "b"), prev, curr, { midHistory: true, kindHint: "typo" }).changeKind).toBe("typo");
    expect(Object.keys(own)).toEqual(["diff", "changeKind"]);
  });

  it("an addition shows its body only mid-history", () => {
    expect(eventDiff(ev("added", "d"), prev, curr, { midHistory: true })).toEqual({ diff: [["+", "fresh"]] });
    expect(eventDiff(ev("added", "d"), prev, curr, { midHistory: false })).toEqual({});
  });

  it("a removal shows the body it lost, cut at 20 lines", () => {
    const { diff } = eventDiff(ev("removed", "c"), prev, curr, { midHistory: true });
    expect(diff).toHaveLength(21);
    expect(diff![0]).toEqual(["-", "l0"]);
    expect(diff![20]).toEqual(["…"]);
  });

  it("a move carries its paths", () => {
    expect(eventDiff(ev("moved", "b"), prev, curr, { midHistory: true })).toEqual({ movedFrom: "x.md", movedTo: "y.md" });
  });
});
