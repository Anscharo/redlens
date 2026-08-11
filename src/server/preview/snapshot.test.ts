// Layout-agnostic preview diffing: parsing a checkout (any layout) or a built
// docs.json into a uuid-keyed snapshot, and picking the base side.
//
// diffSnapshots itself is covered in preview.test.ts. This file covers the three
// functions that touch the filesystem and the tarball fetcher.

import { test, expect, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  diffSnapshots,
  loadBaseSnapshot,
  snapshotFromDocsJson,
  snapshotFromSrcDir,
  type Snapshot,
} from "./snapshot.ts";

const tmpDirs: string[] = [];
const origMinNodes = process.env.ATLAS_MIN_NODES;

afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  if (origMinNodes === undefined) delete process.env.ATLAS_MIN_NODES;
  else process.env.ATLAS_MIN_NODES = origMinNodes;
});

function mkTmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "pv-snap-"));
  tmpDirs.push(d);
  return d;
}

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const heading = (depth: number, docNo: string, title: string, uuid: string) =>
  `${"#".repeat(depth)} ${docNo} - ${title} [Core]  <!-- UUID: ${uuid} -->`;

/** An atlas checkout in the consolidated layout (upstream #294 onwards). */
function writeConsolidated(root: string): void {
  fs.mkdirSync(path.join(root, "content"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "content", "A.0 - Preamble.md"),
    [heading(1, "A.0", "Preamble", U(1)), "", "intro", "", heading(2, "A.0.1", "First", U(2)), "", "body", ""].join("\n"),
  );
}

/** The same two documents in the atomized layout (#236..#294). */
function writeAtomized(root: string): void {
  const doc = (rel: string, id: string, docNo: string, name: string, body: string) => {
    const dir = path.join(root, "content", ...rel.split("/"));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "document.md"),
      ["---", `id: ${id}`, `docNo: ${docNo}`, `name: ${name}`, "type: Core", "---", "", "# h", "", body, ""].join("\n"),
    );
  };
  doc("A/0", U(1), "A.0", "Preamble", "intro");
  doc("A/0/1", U(2), "A.0.1", "First", "body");
}

test("snapshotFromSrcDir reads a checkout into a uuid-keyed snapshot", () => {
  process.env.ATLAS_MIN_NODES = "0"; // fixture atlas, not the real ~11k
  const root = mkTmp();
  writeConsolidated(root);

  const snap = snapshotFromSrcDir(root);
  expect([...snap.keys()].sort()).toEqual([U(1), U(2)]);
  expect(snap.get(U(1))!.doc_no).toBe("A.0");
  expect(snap.get(U(2))!.title).toBe("First");
  expect(snap.get(U(2))!.content).toBe("body");
  expect(snap.get(U(1))!.contentHash).toBeTruthy();
});

test("snapshotFromSrcDir is layout-blind: both layouts yield the same snapshot", () => {
  // The property the whole approach rests on. If these ever diverged, a preview
  // opened across the cutover would report every document as changed.
  process.env.ATLAS_MIN_NODES = "0";
  const consolidated = mkTmp();
  const atomized = mkTmp();
  writeConsolidated(consolidated);
  writeAtomized(atomized);

  const a = snapshotFromSrcDir(consolidated);
  const b = snapshotFromSrcDir(atomized);
  expect([...b.keys()].sort()).toEqual([...a.keys()].sort());
  for (const id of a.keys()) {
    expect(b.get(id)!.contentHash).toBe(a.get(id)!.contentHash);
    expect(b.get(id)!.doc_no).toBe(a.get(id)!.doc_no);
    expect(b.get(id)!.title).toBe(a.get(id)!.title);
  }
});

test("snapshotFromSrcDir refuses a truncated checkout rather than reporting a tiny atlas", () => {
  // Without the floor, a partial base tree would make nearly every document in
  // the preview look ADDED. build.ts's outer catch turns this into "no diff.json"
  // → the reader falls back to the vs-main diff, which is the safe degradation.
  const root = mkTmp();
  writeConsolidated(root); // 2 documents, far under the default floor
  expect(() => snapshotFromSrcDir(root)).toThrow(/Refusing to publish an empty atlas/);
});

test("snapshotFromDocsJson reads a built bundle", () => {
  const out = mkTmp();
  fs.writeFileSync(
    path.join(out, "docs.json"),
    JSON.stringify({
      nodes: {
        [U(1)]: { id: U(1), doc_no: "A.1", title: "One", content: "body one", contentHash: "h1" },
        [U(2)]: { id: U(2), doc_no: "A.2", title: "Two", content: "body two", contentHash: "h2" },
      },
    }),
  );
  const snap = snapshotFromDocsJson(out);
  expect(snap.size).toBe(2);
  expect(snap.get(U(2))).toEqual({ id: U(2), doc_no: "A.2", title: "Two", content: "body two", contentHash: "h2" });
});

test("loadBaseSnapshot reuses the live atlas when the merge base is the commit we already serve", async () => {
  const live: Snapshot = new Map([[U(9), { id: U(9), doc_no: "A.9", title: "Live", content: "x" }]]);
  let fetched = false;
  const snap = await loadBaseSnapshot(
    "abc123",
    "/nonexistent",
    async () => {
      fetched = true;
      return { srcDir: "/nonexistent" };
    },
    { atlasCommit: "abc123", snapshot: () => live },
  );
  expect(snap).toBe(live);
  expect(fetched).toBe(false); // the common case must cost nothing
});

test("loadBaseSnapshot fetches when the merge base is some other commit, then cleans up", async () => {
  process.env.ATLAS_MIN_NODES = "0";
  const fetchedInto = mkTmp();
  writeConsolidated(fetchedInto);
  const scratch = path.join(mkTmp(), "base");

  const calls: string[] = [];
  const snap = await loadBaseSnapshot(
    "0ldsha",
    scratch,
    async (sha, dir) => {
      calls.push(`${sha}→${dir}`);
      return { srcDir: fetchedInto };
    },
    { atlasCommit: "different", snapshot: () => new Map() },
  );

  expect(calls).toEqual([`0ldsha→${scratch}`]);
  expect([...snap.keys()].sort()).toEqual([U(1), U(2)]);
  expect(fs.existsSync(scratch)).toBe(false); // scratch dir removed after parsing
});

test("loadBaseSnapshot fetches when there is no live atlas to compare against", async () => {
  process.env.ATLAS_MIN_NODES = "0";
  const fetchedInto = mkTmp();
  writeConsolidated(fetchedInto);
  let fetched = false;
  const snap = await loadBaseSnapshot("0ldsha", path.join(mkTmp(), "base"), async () => {
    fetched = true;
    return { srcDir: fetchedInto };
  });
  expect(fetched).toBe(true);
  expect(snap.size).toBe(2);
});

test("loadBaseSnapshot still clears the scratch dir when parsing throws", async () => {
  const fetchedInto = mkTmp();
  writeConsolidated(fetchedInto); // under the floor → snapshotFromSrcDir throws
  const scratch = path.join(mkTmp(), "base");
  fs.mkdirSync(scratch, { recursive: true });

  await expect(
    loadBaseSnapshot("0ldsha", scratch, async () => ({ srcDir: fetchedInto })),
  ).rejects.toThrow(/Refusing to publish an empty atlas/);
  expect(fs.existsSync(scratch)).toBe(false);
});

test("a preview spanning the layout cutover reports only REAL changes", async () => {
  // The scenario that has to keep working while upstream migrates: the merge
  // base is still atomized, the PR head is consolidated. Diffing by uuid means
  // the regrouping itself is invisible — only edited documents surface.
  // Verified against the real trees too: atomized main vs the consolidated
  // #294 head is 11,335 docs on both sides with 0 added/changed/removed.
  process.env.ATLAS_MIN_NODES = "0";
  const atomizedBase = mkTmp();
  const consolidatedHead = mkTmp();
  writeAtomized(atomizedBase);
  writeConsolidated(consolidatedHead);

  const base = snapshotFromSrcDir(atomizedBase);
  expect(diffSnapshots(base, snapshotFromSrcDir(consolidatedHead))).toEqual({
    added: [],
    changed: [],
    removed: [],
  });

  // Now genuinely edit one document in the consolidated head — it must surface,
  // and its untouched sibling must not.
  fs.writeFileSync(
    path.join(consolidatedHead, "content", "A.0 - Preamble.md"),
    [heading(1, "A.0", "Preamble", U(1)), "", "intro", "", heading(2, "A.0.1", "First", U(2)), "", "EDITED body", ""].join("\n"),
  );
  const d = diffSnapshots(base, snapshotFromSrcDir(consolidatedHead));
  expect(d.changed).toEqual([U(2)]);
  expect(d.added).toEqual([]);
  expect(d.removed).toEqual([]);
});
