import { describe, expect, test } from "bun:test";
import { computeDiffArtifacts } from "./diff-artifacts.ts";
import type { Snapshot, SnapshotDoc } from "./snapshot.ts";

function snap(docs: SnapshotDoc[]): Snapshot {
  return new Map(docs.map((d) => [d.id, d]));
}

const P = "00000000-0000-4000-8000-0000000000a1";
const C = "00000000-0000-4000-8000-0000000000a2";
const E = "00000000-0000-4000-8000-0000000000a3";
const T = "00000000-0000-4000-8000-0000000000a4";

describe("renumberedOnly", () => {
  test("a moved doc with an untouched body is renumber-only", () => {
    const base = snap([{ id: P, doc_no: "A.1", title: "Parent", content: "body" }]);
    const head = snap([{ id: P, doc_no: "A.2", title: "Parent", content: "body" }]);
    expect(computeDiffArtifacts(base, head, base).diff.renumberedOnly).toEqual([P]);
  });

  test("a body citing a moved sibling stays renumber-only", () => {
    const base = snap([
      { id: P, doc_no: "A.1.1", title: "Parent", content: "See A.1.2." },
      { id: C, doc_no: "A.1.2", title: "Child", content: "Per A.1.1, done." },
    ]);
    const head = snap([
      { id: P, doc_no: "A.1.2", title: "Parent", content: "See A.1.1." },
      { id: C, doc_no: "A.1.1", title: "Child", content: "Per A.1.2, done." },
    ]);
    expect(computeDiffArtifacts(base, head, base).diff.renumberedOnly?.sort()).toEqual([P, C].sort());
  });

  test("a moved doc with a real body edit, or a new title, is not", () => {
    const base = snap([
      { id: E, doc_no: "A.1", title: "Edit", content: "old words" },
      { id: T, doc_no: "A.2", title: "Old title", content: "same" },
    ]);
    const head = snap([
      { id: E, doc_no: "A.3", title: "Edit", content: "new words" },
      { id: T, doc_no: "A.4", title: "New title", content: "same" },
    ]);
    expect(computeDiffArtifacts(base, head, base).diff.renumberedOnly).toEqual([]);
  });

  test("a body edit without a move is not", () => {
    const base = snap([{ id: E, doc_no: "A.1", title: "Edit", content: "a" }]);
    const head = snap([{ id: E, doc_no: "A.1", title: "Edit", content: "b" }]);
    expect(computeDiffArtifacts(base, head, base).diff.renumberedOnly).toEqual([]);
  });
});
