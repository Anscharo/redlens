// Pure tests for computeDiffArtifacts/writeDiffArtifacts — no build, no
// subprocess, no network. Covers the six shape cases from the plan, keyed on
// document identity (uuid) the way the real diff pipeline is.
import { afterAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { computeDiffArtifacts, writeDiffArtifacts } from "./diff-artifacts.ts";
import type { Snapshot, SnapshotDoc } from "./snapshot.ts";

function snap(docs: SnapshotDoc[]): Snapshot {
  return new Map(docs.map((d) => [d.id, d]));
}

const ID1 = "00000000-0000-4000-8000-000000000001";
const ID2 = "00000000-0000-4000-8000-000000000002";
const ID3 = "00000000-0000-4000-8000-000000000003";

describe("computeDiffArtifacts", () => {
  test("added doc: patch is all pure additions, no other fields touched", () => {
    const base: Snapshot = snap([]);
    const live: Snapshot = snap([]);
    const head = snap([{ id: ID1, doc_no: "A.1", title: "One", content: "line one\nline two" }]);
    const { diff, patches } = computeDiffArtifacts(base, head, live);
    expect(diff.added).toEqual([ID1]);
    expect(diff.changed).toEqual([]);
    expect(patches[ID1]).toBeDefined();
    expect(patches[ID1].every((l) => l[0] === "+")).toBe(true);
    expect(patches[ID1].map((l) => (l as ["+", string])[1])).toEqual(["line one", "line two"]);
    expect(diff.renumbered).toEqual({});
    expect(diff.retitled).toEqual({});
  });

  test("changed doc: patch is computed vs LIVE, not vs base", () => {
    const base = snap([{ id: ID1, doc_no: "A.1", title: "One", content: "aaa aaa", contentHash: "b1" }]);
    const live = snap([{ id: ID1, doc_no: "A.1", title: "One", content: "bbb bbb", contentHash: "l1" }]);
    const head = snap([{ id: ID1, doc_no: "A.1", title: "One", content: "ccc ccc", contentHash: "h1" }]);
    const { diff, patches } = computeDiffArtifacts(base, head, live);
    expect(diff.changed).toEqual([ID1]);
    expect(patches[ID1]).toBeDefined();
    // The removed side of the patch must be LIVE content ("bbb"), never base ("aaa").
    const rendered = JSON.stringify(patches[ID1]);
    expect(rendered).toContain("bbb");
    expect(rendered).not.toContain("aaa");
  });

  test("renumber-only: doc_no differs, content/title identical → renumbered, still a patch-worthy change if content differs; no patch when content is identical", () => {
    const base = snap([{ id: ID1, doc_no: "A.1", title: "One", content: "same content", contentHash: "h1" }]);
    const live = snap([{ id: ID1, doc_no: "A.1", title: "One", content: "same content", contentHash: "h1" }]);
    const head = snap([{ id: ID1, doc_no: "A.9", title: "One", content: "same content", contentHash: "h1" }]);
    const { diff, patches } = computeDiffArtifacts(base, head, live);
    expect(diff.changed).toEqual([ID1]); // doc_no differs → diffSnapshots flags it
    expect(diff.renumbered).toEqual({ [ID1]: ["A.1", "A.9"] });
    expect(diff.retitled).toEqual({});
    expect(patches[ID1]).toBeUndefined(); // content identical vs live → no patch
  });

  test("title-only edit: retitled set, no patch", () => {
    const base = snap([{ id: ID1, doc_no: "A.1", title: "Old Title", content: "body", contentHash: "h1" }]);
    const live = snap([{ id: ID1, doc_no: "A.1", title: "Old Title", content: "body", contentHash: "h1" }]);
    const head = snap([{ id: ID1, doc_no: "A.1", title: "New Title", content: "body", contentHash: "h1" }]);
    const { diff, patches } = computeDiffArtifacts(base, head, live);
    expect(diff.changed).toEqual([ID1]); // title differs → diffSnapshots flags it
    expect(diff.retitled).toEqual({ [ID1]: ["Old Title", "New Title"] });
    expect(diff.renumbered).toEqual({});
    expect(patches[ID1]).toBeUndefined();
  });

  test("class 4: changed vs base but absent from live → patch computed vs base, not skipped", () => {
    const base = snap([{ id: ID1, doc_no: "A.1", title: "One", content: "base content", contentHash: "b1" }]);
    const live: Snapshot = snap([]); // live doesn't have this doc at all
    const head = snap([{ id: ID1, doc_no: "A.1", title: "One", content: "head content", contentHash: "h1" }]);
    const { diff, patches } = computeDiffArtifacts(base, head, live);
    expect(diff.changed).toEqual([ID1]);
    expect(patches[ID1]).toBeDefined();
    expect(patches[ID1].length).toBeGreaterThan(0);
  });

  test("raw-only edit: contentHash differs but cleaned content/title/doc_no are identical → changed, no patch, no retitle", () => {
    const base = snap([{ id: ID1, doc_no: "A.1", title: "One", content: "same content", contentHash: "raw-a" }]);
    const live = snap([{ id: ID1, doc_no: "A.1", title: "One", content: "same content", contentHash: "raw-a" }]);
    const head = snap([{ id: ID1, doc_no: "A.1", title: "One", content: "same content", contentHash: "raw-b" }]);
    const { diff, patches } = computeDiffArtifacts(base, head, live);
    expect(diff.changed).toEqual([ID1]); // hash differs → diffSnapshots flags it
    expect(patches[ID1]).toBeUndefined(); // cleaned content identical → no visible patch
    expect(diff.retitled[ID1]).toBeUndefined();
    expect(diff.renumbered[ID1]).toBeUndefined();
  });

  test("unrelated live doc is untouched by a changed/added mix (sanity: multiple docs don't cross-contaminate)", () => {
    const base = snap([{ id: ID2, doc_no: "A.2", title: "Two", content: "two", contentHash: "h2" }]);
    const live = snap([{ id: ID2, doc_no: "A.2", title: "Two", content: "two", contentHash: "h2" }]);
    const head = snap([
      { id: ID2, doc_no: "A.2", title: "Two", content: "two", contentHash: "h2" },
      { id: ID3, doc_no: "A.3", title: "Three", content: "three", contentHash: "h3" },
    ]);
    const { diff, patches } = computeDiffArtifacts(base, head, live);
    expect(diff.added).toEqual([ID3]);
    expect(diff.changed).toEqual([]);
    expect(Object.keys(patches)).toEqual([ID3]);
  });
});

describe("writeDiffArtifacts", () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  });

  test("writes both diff.json and patches.json with the computed shapes", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "diff-artifacts-"));
    dirs.push(dir);
    const base: Snapshot = snap([]);
    const live: Snapshot = snap([]);
    const head = snap([{ id: ID1, doc_no: "A.1", title: "One", content: "hello" }]);
    const result = computeDiffArtifacts(base, head, live);
    writeDiffArtifacts(dir, result);

    const diffOnDisk = JSON.parse(fs.readFileSync(path.join(dir, "diff.json"), "utf8"));
    const patchesOnDisk = JSON.parse(fs.readFileSync(path.join(dir, "patches.json"), "utf8"));
    expect(diffOnDisk).toEqual(result.diff);
    expect(patchesOnDisk).toEqual(result.patches);
    expect(diffOnDisk.added).toEqual([ID1]);
    expect(patchesOnDisk[ID1]).toBeDefined();
  });
});
