// Pure-trio tests: id resolution, tarball extraction + caps, disk cache.
// Run via `bun test` (needs Bun.Archive / Bun.gzipSync). No DB, no network.

import { test, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { execFileSync } from "node:child_process";

import { decodeId, gateError, resolveRef, checkForkLineage, isFork, repoOwner, type GhClient } from "./resolve.ts";
import { tierFor, effectivePrTier } from "./trust.ts";
import {
  gunzipCapped,
  extractContentArchive,
  CapExceededError,
  archiveUrl,
} from "./tarball.ts";
import { previewPaths, artifactPath, bundleReady, writeMeta, evictLru } from "./cache.ts";
import { diffSnapshots, type Snapshot } from "./snapshot.ts";

// ---------------------------------------------------------------------------
// resolve
// ---------------------------------------------------------------------------

test("decodeId parses every id form", () => {
  expect(decodeId("a".repeat(40))).toEqual({ kind: "sha", sha: "a".repeat(40) });
  expect(decodeId("pull-256")).toEqual({ kind: "pr", prNumber: 256 });
  expect(decodeId("blimpa:spark")).toEqual({ kind: "branch", owner: "blimpa", repo: "blimpa/next-gen-atlas", ref: "spark" });
  expect(decodeId("my-branch")).toEqual({
    kind: "branch",
    owner: "sky-ecosystem",
    repo: "sky-ecosystem/next-gen-atlas",
    ref: "my-branch",
  });
  // ~ decodes to / in the ref
  expect(decodeId("blimpa:feat~parser-fix")).toMatchObject({ ref: "feat/parser-fix" });
  expect(decodeId("feat~x")).toMatchObject({ owner: "sky-ecosystem", ref: "feat/x" });
  // renamed fork: owner:repo:branch
  expect(decodeId("blimpa:my-atlas:spark")).toEqual({ kind: "branch", owner: "blimpa", repo: "blimpa/my-atlas", ref: "spark" });
  expect(decodeId("blimpa:my-atlas:feat~x")).toMatchObject({ repo: "blimpa/my-atlas", ref: "feat/x" });
  expect(decodeId("a:b:c:d")).toBeNull(); // refs can't contain ':'
});

test("gate passes everything (forks screened by lineage + trust, not grammar)", () => {
  expect(gateError(decodeId("blimpa:spark")!)).toBeNull();
  expect(gateError(decodeId("my-branch")!)).toBeNull();
  expect(gateError(decodeId("pull-1")!)).toBeNull();
  expect(gateError(decodeId("a".repeat(40))!)).toBeNull();
});

test("isFork / repoOwner helpers", () => {
  expect(isFork("blimpa/next-gen-atlas")).toBe(true);
  expect(isFork("sky-ecosystem/next-gen-atlas")).toBe(false);
  // a same-owner lookalike repo is NOT canonical — fork-treated
  expect(isFork("sky-ecosystem/lookalike")).toBe(true);
  expect(repoOwner("blimpa/next-gen-atlas")).toBe("blimpa");
});

function fakeGh(map: Record<string, { ok?: boolean; status?: number; json: any }>): GhClient {
  return {
    async fetchJson(p) {
      const r = map[p];
      if (!r) return { ok: false, status: 404, json: null };
      return { ok: r.ok ?? true, status: r.status ?? 200, json: r.json };
    },
  };
}

test("resolveRef: PR → fork head repo + sha + state + head-commit date", async () => {
  const gh = fakeGh({
    "/repos/sky-ecosystem/next-gen-atlas/pulls/256": {
      json: { title: "Spark", user: { login: "blimpa" }, state: "open", merged_at: null, head: { repo: { full_name: "blimpa/next-gen-atlas" }, sha: "deadbeef" } },
    },
    // The pulls payload has no commit date, so resolveRef asks for the commit.
    "/repos/blimpa/next-gen-atlas/commits/deadbeef": {
      json: { commit: { committer: { date: "2026-06-15T10:00:00Z" } } },
    },
  });
  const r = await resolveRef(decodeId("pull-256")!, gh);
  expect(r).toMatchObject({ repo: "blimpa/next-gen-atlas", sha: "deadbeef", kind: "pr", ref: "pull-256", pr: { state: "open", author: "blimpa" }, date: "2026-06-15T10:00:00Z" });
});

test("resolveRef: a PR still resolves when the head-commit lookup fails, just undated", async () => {
  const gh = fakeGh({
    "/repos/sky-ecosystem/next-gen-atlas/pulls/9": {
      json: { title: "x", user: { login: "a" }, state: "open", merged_at: null, head: { repo: { full_name: "sky-ecosystem/next-gen-atlas" }, sha: "abc" } },
    },
  });
  const r = await resolveRef(decodeId("pull-9")!, gh);
  expect((r as any).sha).toBe("abc");
  expect((r as any).date).toBeUndefined();
});

test("resolveRef: merged PR reports merged state", async () => {
  const gh = fakeGh({
    "/repos/sky-ecosystem/next-gen-atlas/pulls/7": {
      json: { title: "x", user: { login: "a" }, state: "closed", merged_at: "2026-01-01T00:00:00Z", head: { repo: { full_name: "sky-ecosystem/next-gen-atlas" }, sha: "abc" } },
    },
  });
  const r = await resolveRef(decodeId("pull-7")!, gh);
  expect((r as any).pr.state).toBe("merged");
});

test("resolveRef: canonical branch → tip sha + its commit date; missing → not-found", async () => {
  const gh = fakeGh({
    "/repos/sky-ecosystem/next-gen-atlas/branches/main": {
      json: { commit: { sha: "tip123", commit: { committer: { date: "2026-07-01T09:00:00Z" } } } },
    },
  });
  expect(await resolveRef(decodeId("main")!, gh)).toMatchObject({ sha: "tip123", kind: "branch", date: "2026-07-01T09:00:00Z" });
  expect(await resolveRef(decodeId("nope")!, gh)).toEqual({ error: "not-found" });
});

test("checkForkLineage: true fork ok, lookalike rejected, missing repo not-found", async () => {
  const trueFork = fakeGh({
    "/repos/blimpa/next-gen-atlas": { json: { fork: true, parent: { full_name: "sky-ecosystem/next-gen-atlas" } } },
  });
  expect(await checkForkLineage("blimpa/next-gen-atlas", trueFork)).toBe("ok");

  const lookalike = fakeGh({ "/repos/evil/next-gen-atlas": { json: { fork: false } } });
  expect(await checkForkLineage("evil/next-gen-atlas", lookalike)).toBe("not-a-fork");

  const forkOfOther = fakeGh({
    "/repos/x/next-gen-atlas": { json: { fork: true, parent: { full_name: "someone/else" } } },
  });
  expect(await checkForkLineage("x/next-gen-atlas", forkOfOther)).toBe("not-a-fork");

  expect(await checkForkLineage("ghost/next-gen-atlas", fakeGh({}))).toBe("not-found");
});

test("resolveRef: true-fork branch resolves; lookalike → not-a-fork", async () => {
  const gh = fakeGh({
    "/repos/blimpa/next-gen-atlas": { json: { fork: true, source: { full_name: "sky-ecosystem/next-gen-atlas" } } },
    "/repos/blimpa/next-gen-atlas/branches/spark": { json: { commit: { sha: "forktip" } } },
  });
  expect(await resolveRef(decodeId("blimpa:spark")!, gh)).toMatchObject({
    repo: "blimpa/next-gen-atlas",
    sha: "forktip",
    kind: "branch",
    ref: "spark",
  });

  const evil = fakeGh({ "/repos/evil/next-gen-atlas": { json: { fork: false } } });
  expect(await resolveRef(decodeId("evil:spark")!, evil)).toEqual({ error: "not-a-fork" });
});

test("resolveRef: RENAMED fork resolves through the same lineage screen", async () => {
  const gh = fakeGh({
    "/repos/blimpa/my-atlas": { json: { fork: true, source: { full_name: "sky-ecosystem/next-gen-atlas" } } },
    "/repos/blimpa/my-atlas/branches/spark": { json: { commit: { sha: "renamedtip" } } },
  });
  expect(await resolveRef(decodeId("blimpa:my-atlas:spark")!, gh)).toMatchObject({
    repo: "blimpa/my-atlas",
    sha: "renamedtip",
    kind: "branch",
  });
  // canonical-owner lookalike repo goes through lineage too (and fails it)
  const lookalike = fakeGh({ "/repos/sky-ecosystem/lookalike": { json: { fork: false } } });
  expect(await resolveRef(decodeId("sky-ecosystem:lookalike:main")!, lookalike)).toEqual({ error: "not-a-fork" });
});

test("trust tierFor: whitelist/atlas-merged → trusted; org-merged → known; history-less by account age", () => {
  expect(tierFor(0, 0, 9999, true)).toBe("trusted"); // whitelist
  expect(tierFor(0, 5, 10, false)).toBe("trusted"); // atlas-merged trumps account age
  expect(tierFor(3, 0, 10, false)).toBe("known"); // org-merged, never atlas
  expect(tierFor(0, 0, 1500, false)).toBe("unknown"); // no history, old account
  expect(tierFor(0, 0, 3, false)).toBe("refused"); // no history, fresh account
});

test("effectivePrTier: PR-ness only un-refuses, never upgrades", () => {
  expect(effectivePrTier("refused")).toBe("unknown");
  expect(effectivePrTier("unknown")).toBe("unknown");
  expect(effectivePrTier("known")).toBe("known");
  expect(effectivePrTier("trusted")).toBe("trusted");
});

test("archiveUrl points at the resolved (fork) repo", () => {
  expect(archiveUrl("blimpa/next-gen-atlas", "abc")).toBe("https://github.com/blimpa/next-gen-atlas/archive/abc.tar.gz");
});

// ---------------------------------------------------------------------------
// snapshot diff (layout-agnostic: compares documents by uuid, not by filename)
// ---------------------------------------------------------------------------

function snap(docs: [string, string, string, string?][]): Snapshot {
  return new Map(
    docs.map(([id, doc_no, content, title]) => [id, { id, doc_no, content, title: title ?? doc_no }]),
  );
}

test("diffSnapshots splits added / changed / removed by document identity", () => {
  const base = snap([
    ["id-keep", "A.1", "unchanged"],
    ["id-edit", "A.2", "before"],
    ["id-gone", "A.3", "deleted"],
  ]);
  const head = snap([
    ["id-keep", "A.1", "unchanged"],
    ["id-edit", "A.2", "after"],
    ["id-new", "A.4", "brand new"],
  ]);
  const d = diffSnapshots(base, head);
  expect(d.added).toEqual(["id-new"]);
  expect(d.changed).toEqual(["id-edit"]);
  expect(d.removed).toEqual(["id-gone"]);
});

test("diffSnapshots: a renumbered or renamed doc is CHANGED, not added", () => {
  const base = snap([["id-a", "A.2", "same body", "Old Title"]]);
  // same uuid, new doc number and new title, identical body
  const head = snap([["id-a", "A.7", "same body", "New Title"]]);
  const d = diffSnapshots(base, head);
  expect(d.added).toEqual([]);
  expect(d.changed).toEqual(["id-a"]);
  expect(d.removed).toEqual([]);
});

test("diffSnapshots: a new uuid in a reused doc number is ADDED, its occupant REMOVED", () => {
  const base = snap([["old-uuid", "A.5", "original"]]);
  const head = snap([["new-uuid", "A.5", "replacement"]]);
  const d = diffSnapshots(base, head);
  expect(d.added).toEqual(["new-uuid"]);
  expect(d.removed).toEqual(["old-uuid"]);
  expect(d.changed).toEqual([]);
});

test("diffSnapshots prefers contentHash when present", () => {
  const base: Snapshot = new Map([["id", { id: "id", doc_no: "A.1", title: "T", content: "x", contentHash: "h1" }]]);
  // body text differs but the hash is the same → not a change (hash is authoritative)
  const head: Snapshot = new Map([["id", { id: "id", doc_no: "A.1", title: "T", content: "y", contentHash: "h1" }]]);
  expect(diffSnapshots(base, head).changed).toEqual([]);
});

// ---------------------------------------------------------------------------
// tarball
// ---------------------------------------------------------------------------

// The property under test is the expansion ratio, not the absolute size: a
// tiny gz that decompresses past the cap must reject. Sizes are kept small
// (8MB expanding from a few KB, 1MB cap) because gzipping tens of megabytes is
// pure CPU — at 40MB/15MB this test ran close enough to bun's 5s default
// budget that a loaded CI runner tipped it over. Timeout is also stated
// explicitly rather than inherited, so the budget doesn't silently shrink.
test(
  "gunzipCapped aborts a decompression bomb mid-stream",
  async () => {
    const bomb = Bun.gzipSync(new Uint8Array(8 * 1024 * 1024)); // 8MB of zeros → tiny gz
    expect(bomb.length).toBeLessThan(64_000);
    await expect(gunzipCapped(Readable.from(Buffer.from(bomb)), 1024 * 1024)).rejects.toBeInstanceOf(CapExceededError);
  },
  30_000,
);

test("gunzipCapped returns small payloads intact", async () => {
  const payload = Buffer.from("hello content tree");
  const gz = Buffer.from(Bun.gzipSync(payload));
  const out = await gunzipCapped(Readable.from(gz), 15 * 1024 * 1024);
  expect(out.equals(payload)).toBe(true);
});

// Build a GitHub-style gz tarball: top dir `next-gen-atlas-<sha>` with content/** + junk.
function makeAtlasTarGz(docs: Record<string, string>, extra: Record<string, string> = {}): Buffer {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "mk-tar-"));
  const top = path.join(work, "next-gen-atlas-abc");
  for (const [rel, body] of Object.entries({ ...prefixed("content", docs), ...extra })) {
    const f = path.join(top, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, body);
  }
  const gzPath = path.join(work, "a.tar.gz");
  execFileSync("tar", ["-czf", gzPath, "-C", work, "next-gen-atlas-abc"]);
  const gz = fs.readFileSync(gzPath);
  fs.rmSync(work, { recursive: true, force: true });
  return gz;
}
function prefixed(pre: string, m: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [`${pre}/${k}`, v]));
}

test("extractContentArchive: extracts content/**, ignores junk, counts docs", async () => {
  const gz = makeAtlasTarGz(
    { "A/0/document.md": "preamble", "A/1/document.md": "gov", "A/1/_index.md": "idx" },
    { "README.md": "readme", "sync/compose.py": "py" },
  );
  const plain = Buffer.from(Bun.gunzipSync(gz as unknown as Uint8Array<ArrayBuffer>));
  const atlasDir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-"));
  const { srcDir, docCount } = await extractContentArchive(plain, atlasDir);
  expect(docCount).toBe(2);
  expect(fs.readFileSync(path.join(srcDir, "content/A/0/document.md"), "utf8")).toBe("preamble");
  expect(fs.existsSync(path.join(srcDir, "content/A/1/_index.md"))).toBe(true);
  // junk is extracted alongside but the build only reads content/, so it's harmless;
  // what matters is srcDir/content is the parse root.
  fs.rmSync(atlasDir, { recursive: true, force: true });
});

test("extractContentArchive: counts documents in the consolidated layout too", async () => {
  // Counting `document.md` files alone returned 0 here, which made the maxDocs
  // cap inert and reported docCount: 0 on every preview after upstream #294.
  const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const bucket = [1, 2, 3].map((n) => `## A.${n} - Doc${n} [Core]  <!-- UUID: ${uuid(n)} -->\n\nbody\n`).join("\n");
  const gz = makeAtlasTarGz({ "A.1 - The-Governance-Scope.md": bucket, "README.md": "not a bucket" });
  const plain = Buffer.from(Bun.gunzipSync(gz as unknown as Uint8Array<ArrayBuffer>));
  const atlasDir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-"));
  const { docCount } = await extractContentArchive(plain, atlasDir);
  expect(docCount).toBe(3); // one file, three documents
  fs.rmSync(atlasDir, { recursive: true, force: true });
});

test("extractContentArchive: doc cap aborts and cleans up", async () => {
  const gz = makeAtlasTarGz({ "A/0/document.md": "x", "A/1/document.md": "y" });
  const plain = Buffer.from(Bun.gunzipSync(gz as unknown as Uint8Array<ArrayBuffer>));
  const atlasDir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-"));
  await expect(extractContentArchive(plain, atlasDir, { maxBytes: 1e9, maxDocs: 1 })).rejects.toBeInstanceOf(CapExceededError);
  expect(fs.existsSync(atlasDir)).toBe(false); // cleaned
});

test("extractContentArchive: tarball with no content/ is rejected", async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "mk-"));
  fs.mkdirSync(path.join(work, "next-gen-atlas-abc"));
  fs.writeFileSync(path.join(work, "next-gen-atlas-abc", "README.md"), "x");
  const gzPath = path.join(work, "a.tar.gz");
  execFileSync("tar", ["-czf", gzPath, "-C", work, "next-gen-atlas-abc"]);
  const plain = Buffer.from(Bun.gunzipSync(fs.readFileSync(gzPath)));
  const atlasDir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-"));
  await expect(extractContentArchive(plain, atlasDir)).rejects.toThrow(/content/);
  fs.rmSync(work, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// cache
// ---------------------------------------------------------------------------

test("previewPaths + artifact allowlist", () => {
  const p = previewPaths("abc", "/tmp/pv");
  expect(p.srcDir).toBe("/tmp/pv/abc/src");
  expect(p.outDir).toBe("/tmp/pv/abc/out");
  expect(artifactPath("abc", "docs.json", "/tmp/pv")).toBe("/tmp/pv/abc/out/docs.json");
  expect(artifactPath("abc", "meta.json", "/tmp/pv")).toBe("/tmp/pv/abc/meta.json");
  // not allowlisted (on-chain reused from main, and traversal attempts)
  expect(artifactPath("abc", "addresses.json", "/tmp/pv")).toBeNull();
  expect(artifactPath("abc", "../../etc/passwd", "/tmp/pv")).toBeNull();
});

test("bundleReady + evictLru keep newest, drop unfinished", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pvroot-"));
  const mkReady = (sha: string) => {
    const p = previewPaths(sha, root);
    fs.mkdirSync(p.outDir, { recursive: true });
    fs.writeFileSync(path.join(p.outDir, "docs.json"), "{}");
    writeMeta(sha, { sha, repo: "r", ref: "x", kind: "branch", resolvedAt: "t", docCount: 1, buildMs: 1 }, root);
  };
  expect(bundleReady("s1", root)).toBe(false);
  for (const s of ["s1", "s2", "s3"]) mkReady(s);
  expect(bundleReady("s1", root)).toBe(true);
  // an unfinished bundle (atlas only, no out/docs.json)
  fs.mkdirSync(previewPaths("partial", root).srcDir, { recursive: true });

  // Make s3 the most-recent, then keep only 1. Age the OTHERS into the past
  // rather than pushing s3 into the future: some container filesystems
  // (overlayfs, NFS) clamp or round a future mtime back to now, which would
  // silently destroy the ordering this test depends on.
  const past = new Date(Date.now() - 10_000);
  for (const s of ["s1", "s2", "partial"]) fs.utimesSync(previewPaths(s, root).dir, past, past);
  const evicted = evictLru(1, root);
  expect(evicted).toContain("partial"); // unfinished always dropped
  expect(bundleReady("s3", root)).toBe(true); // newest kept
  expect(fs.existsSync(previewPaths("s1", root).dir)).toBe(false); // older evicted
  fs.rmSync(root, { recursive: true, force: true });
});
