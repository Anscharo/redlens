// The branch walk: newest first, merge commits, truncation, and the invariant
// that the rows of every commit account for the branch's whole change.
// Run via `bun test`.

import { describe, expect, test } from "bun:test";

import { makeNodeEntry, type GitSnapshot } from "../../../scripts/lib/atlas-git-parse.ts";
import { diffSnapshots } from "../../../scripts/lib/history-events.ts";
import type { CommitMeta } from "./commit-range.ts";
import { walkCommits, type CommitRecord } from "./commit-walk.ts";

const snap = (docs: Record<string, [string, string]>): GitSnapshot =>
  new Map(Object.entries(docs).map(([id, [docNo, body]]) => [id, makeNodeEntry(docNo, `T${id}`, "Core", body, "content/A.md")]));

const meta = (sha: string, parents: string[]): CommitMeta => ({ sha, parents, date: "2026-10-01T00:00:00Z", author: "a", message: sha });

// base ← c1 (edit a) ← c2 (add b) ← c3 (revert a) ← m (merge of c3 and up) ← c4 (renumber b)
const S: Record<string, GitSnapshot> = {
  base: snap({ a: ["A.1", "one"], u: ["A.7", "up"] }),
  c1: snap({ a: ["A.1", "one EDIT"], u: ["A.7", "up"] }),
  c2: snap({ a: ["A.1", "one EDIT"], b: ["A.2", "new"], u: ["A.7", "up"] }),
  c3: snap({ a: ["A.1", "one"], b: ["A.2", "new"], u: ["A.7", "up"] }),
  up: snap({ a: ["A.1", "one"], u: ["A.7", "up CHANGED"] }),
  m: snap({ a: ["A.1", "one"], b: ["A.2", "new"], u: ["A.7", "up CHANGED"] }),
  c4: snap({ a: ["A.1", "one"], b: ["A.3", "new"], u: ["A.7", "up CHANGED"] }),
};
const COMMITS = [meta("c4", ["m"]), meta("m", ["c3", "up"]), meta("c3", ["c2"]), meta("c2", ["c1"]), meta("c1", ["base"])];

async function walk(commits: CommitMeta[], snaps: Record<string, GitSnapshot> = S) {
  const out: CommitRecord[] = [];
  const loads: string[] = [];
  const r = await walkCommits(commits, {
    loadSnapshot: async (sha) => {
      loads.push(sha);
      if (!snaps[sha]) throw new Error(`missing ${sha}`);
      return snaps[sha];
    },
    emit: (rec, i) => (expect(i).toBe(out.length), out.push(rec)),
  });
  return { ...r, out, loads };
}

describe("walkCommits", () => {
  test("emits newest first, one row set per commit, each snapshot parsed once", async () => {
    const { out, truncated, loads } = await walk(COMMITS);
    expect(truncated).toBe(false);
    expect(out.map((c) => c.sha)).toEqual(["c4", "m", "c3", "c2", "c1"]);
    expect(out[0].entries.b[0]).toMatchObject({ changeType: "renumbered", prevDocNo: "A.2", docNo: "A.3" });
    expect(new Set(loads).size).toBe(loads.length);
  });

  test("a merge that only brings the base in reports nothing", async () => {
    const { out } = await walk(COMMITS);
    expect(out[1]).toMatchObject({ sha: "m", merge: true, entries: {} });
  });

  test("the branch's commits account for every document it changed, and a revert shows both ways", async () => {
    const { out } = await walk(COMMITS);
    const touched = new Set(out.filter((c) => !c.merge).flatMap((c) => Object.keys(c.entries)));
    const ids = (d: ReturnType<typeof diffSnapshots>) => [...d.added, ...d.modified, ...d.removed].map((n) => n.id);
    const fromUpstream = new Set(ids(diffSnapshots(S.base, S.up)));
    const netOnBranch = ids(diffSnapshots(S.base, S.c4)).filter((id) => !fromUpstream.has(id));
    expect(netOnBranch).toEqual(["b"]);
    for (const id of netOnBranch) expect(touched.has(id)).toBe(true);
    expect(out.filter((c) => c.entries.a).map((c) => c.sha)).toEqual(["c3", "c1"]);
    expect(touched.has("u")).toBe(false);
  });

  test("stops at a parent outside the fetched history and says so", async () => {
    const { base: _gone, ...shallow } = S;
    const { out, truncated } = await walk(COMMITS, shallow);
    expect(truncated).toBe(true);
    expect(out.map((c) => c.sha)).toEqual(["c4", "m", "c3", "c2"]);
  });

  test("stops when asked", async () => {
    let n = 0;
    const r = await walkCommits(COMMITS, { loadSnapshot: async (s) => S[s], emit: () => n++, stopped: () => n >= 2 });
    expect(r.truncated).toBe(true);
    expect(n).toBe(2);
  });
});
