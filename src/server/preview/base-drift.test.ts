// base-drift.ts — how the `repo` diff-base candidate's base branch TIP relates
// to sky main right now. Fake GhClient objects (no network); a fake fetchTree
// that either writes a minimal atlas checkout or fails, per test.

import { test, expect, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { computeBaseDrift } from "./base-drift.ts";
import type { Candidate } from "./pr-diff.ts";
import type { Snapshot } from "./snapshot.ts";

const tmpDirs: string[] = [];
const origMinNodes = process.env.ATLAS_MIN_NODES;

afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  if (origMinNodes === undefined) delete process.env.ATLAS_MIN_NODES;
  else process.env.ATLAS_MIN_NODES = origMinNodes;
});

function mkTmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "pv-basedrift-"));
  tmpDirs.push(d);
  return d;
}

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const heading = (docNo: string, title: string, uuid: string) => `# ${docNo} - ${title} [Core]  <!-- UUID: ${uuid} -->`;

/** A minimal consolidated-layout atlas checkout — enough for snapshotFromSrcDir
 *  (ATLAS_MIN_NODES=0 bypasses the real ~11k floor). */
function writeCheckout(root: string): void {
  fs.mkdirSync(path.join(root, "content"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "content", "A.0 - Preamble.md"),
    [heading("A.0", "Preamble", U(1)), "", "intro", "", heading("A.0.1", "First", U(2)), "", "body", ""].join("\n"),
  );
}

function fakeGh(byPath: Record<string, { ok?: boolean; status?: number; json: any }>): any {
  const calls: string[] = [];
  return {
    calls,
    async fetchJson(p: string) {
      calls.push(p);
      const r = byPath[p];
      if (!r) return { ok: false, status: 404, json: null };
      return { ok: r.ok ?? true, status: r.status ?? 200, json: r.json };
    },
  };
}

function candidate(mergeBase = "mb123"): Candidate {
  return { key: "repo", repo: "acme/fork", ref: "develop", mergeBase };
}

test("tip equals the candidate's merge base: reuses the provided snapshot, zero fetchTree calls", async () => {
  const liveSnap: Snapshot = new Map([[U(1), { id: U(1), doc_no: "A.1", title: "One", content: "x" }]]);
  const mergeBaseSnap: Snapshot = new Map([[U(1), { id: U(1), doc_no: "A.1", title: "One", content: "y" }]]);
  let fetchCalls = 0;

  const drift = await computeBaseDrift({
    candidate: candidate("mb123"),
    prBaseSha: "mb123",
    priv: false,
    repoGh: fakeGh({}),
    canonicalGh: fakeGh({}),
    live: { atlasCommit: "atlasA", snapshot: () => liveSnap },
    mergeBaseSnapshot: mergeBaseSnap,
    fetchTree: async () => {
      fetchCalls++;
      return { srcDir: "/never" };
    },
    scratchDir: "/scratch",
  });

  expect(fetchCalls).toBe(0);
  expect(drift?.sha).toBe("mb123");
  expect(drift?.docsDiffer).toBe(1); // content differs on the one shared doc
});

test("tip differs from the merge base: fetchTree is called with the tip sha", async () => {
  process.env.ATLAS_MIN_NODES = "0";
  const fetchedInto = mkTmp();
  writeCheckout(fetchedInto);
  const calls: string[] = [];

  const drift = await computeBaseDrift({
    candidate: candidate("mb123"),
    prBaseSha: "tipsha999",
    priv: false,
    repoGh: fakeGh({}),
    canonicalGh: fakeGh({}),
    live: { atlasCommit: "atlasA", snapshot: () => new Map() },
    fetchTree: async (sha, dir) => {
      calls.push(`${sha}→${dir}`);
      return { srcDir: fetchedInto };
    },
    scratchDir: path.join(mkTmp(), "scratch"),
  });

  expect(calls.length).toBe(1);
  expect(calls[0]!.startsWith("tipsha999→")).toBe(true);
  expect(drift?.docsDiffer).toBe(2); // both fixture docs are "added" vs an empty live atlas
});

test("missing prBaseSha resolves the tip via /branches", async () => {
  process.env.ATLAS_MIN_NODES = "0";
  const fetchedInto = mkTmp();
  writeCheckout(fetchedInto);
  const repoGh = fakeGh({ "/repos/acme/fork/branches/develop": { json: { commit: { sha: "resolvedtip" } } } });

  const drift = await computeBaseDrift({
    candidate: candidate("mb123"),
    priv: false,
    repoGh,
    canonicalGh: fakeGh({}),
    live: { atlasCommit: "atlasA", snapshot: () => new Map() },
    fetchTree: async () => ({ srcDir: fetchedInto }),
    scratchDir: path.join(mkTmp(), "scratch"),
  });

  expect(drift?.sha).toBe("resolvedtip");
});

test("public tip counts come from the canonical compare", async () => {
  process.env.ATLAS_MIN_NODES = "0";
  const fetchedInto = mkTmp();
  writeCheckout(fetchedInto);
  const canonicalGh = fakeGh({
    "/repos/sky-ecosystem/next-gen-atlas/compare/atlasA...tipsha": {
      json: { merge_base_commit: { sha: "fp1" }, ahead_by: 3, behind_by: 7 },
    },
  });

  const drift = await computeBaseDrift({
    candidate: candidate("mb123"),
    prBaseSha: "tipsha",
    priv: false,
    repoGh: fakeGh({}),
    canonicalGh,
    live: { atlasCommit: "atlasA", snapshot: () => new Map() },
    fetchTree: async () => ({ srcDir: fetchedInto }),
    scratchDir: path.join(mkTmp(), "scratch"),
  });

  expect(drift?.forkPoint).toBe("fp1");
  expect(drift?.commitsAhead).toBe(3);
  expect(drift?.commitsBehind).toBe(7);
});

test("a private base's drift is measured by CONTENT only: no commit counts, and no commit-list walk or cross-repo compare", async () => {
  // Counting commits since a shared SHA is meaningless for a mirror that takes
  // squash-merged upstream by content — it shares none, or only its original
  // import. `docsDiffer` compares the documents themselves and still holds.
  process.env.ATLAS_MIN_NODES = "0";
  const fetchedInto = mkTmp();
  writeCheckout(fetchedInto);
  // Wired so a walk WOULD find a fork point if one were attempted.
  const repoGh = fakeGh({
    "/repos/acme/priv/commits?sha=tipsha&per_page=100&page=1": { json: [{ sha: "tipsha" }, { sha: "shared1" }] },
    "/repos/acme/priv/compare/shared1...tipsha": { json: { ahead_by: 2 } },
  });
  const canonicalGh = fakeGh({
    "/repos/sky-ecosystem/next-gen-atlas/commits?sha=atlasA&per_page=100&page=1": { json: [{ sha: "shared1" }] },
    "/repos/sky-ecosystem/next-gen-atlas/compare/shared1...atlasA": { json: { ahead_by: 5 } },
  });

  const drift = await computeBaseDrift({
    candidate: { key: "repo", repo: "acme/priv", ref: "develop", mergeBase: "mb123" },
    prBaseSha: "tipsha",
    priv: true,
    repoGh,
    canonicalGh,
    live: { atlasCommit: "atlasA", snapshot: () => new Map() },
    fetchTree: async () => ({ srcDir: fetchedInto }),
    scratchDir: path.join(mkTmp(), "scratch"),
  });

  expect(drift?.sha).toBe("tipsha");
  expect(drift?.forkPoint).toBeUndefined();
  expect(drift?.commitsAhead).toBeUndefined();
  expect(drift?.commitsBehind).toBeUndefined();
  expect(drift?.docsDiffer).toBeGreaterThan(0); // the checkout's docs vs an empty live atlas
  expect(repoGh.calls).toEqual([]);
  expect(canonicalGh.calls).toEqual([]);
});

test("a failed tip resolution degrades the whole result to undefined", async () => {
  const drift = await computeBaseDrift({
    candidate: candidate("mb123"),
    priv: false,
    repoGh: fakeGh({}), // /branches 404 -> no tip
    canonicalGh: fakeGh({}),
    live: { atlasCommit: "atlasA", snapshot: () => new Map() },
    fetchTree: async () => {
      throw new Error("must not be called — no tip to fetch");
    },
    scratchDir: "/scratch",
  });
  expect(drift).toBeUndefined();
});

test("a failed counts fetch and a failed snapshot fetch each degrade to a partial object", async () => {
  const drift = await computeBaseDrift({
    candidate: candidate("mb123"),
    prBaseSha: "tipsha",
    priv: false,
    repoGh: fakeGh({}),
    canonicalGh: fakeGh({}), // compare 404 -> counts all undefined
    live: { atlasCommit: "atlasA", snapshot: () => new Map() },
    fetchTree: async () => {
      throw new Error("tarball fetch failed");
    },
    scratchDir: "/scratch",
  });
  expect(drift).toEqual({ sha: "tipsha", vsAtlasCommit: "atlasA" });
});
