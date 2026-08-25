// bundle-store.ts unit tests. Pure filesystem logic; runs against custom
// BundleStore objects rooted in a throwaway temp dir rather than
// MAIN_STORE/PREVIEW_STORE (those are tied to real config paths) — keeps this
// file's fixtures independent of the real public/atlas tree and of every other
// test file.
import { test, expect, beforeEach, afterAll } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  artifactPath,
  bundleDir,
  bundleReady,
  contentTypeFor,
  evictLru,
  publishBundle,
  remove,
  serveBundleArtifact,
  touch,
  type BundleStore,
  MAIN_STORE,
  PREVIEW_STORE,
  PREVIEW_DIR,
} from "./bundle-store.ts";

// mkdtemp, not a fixed path: two concurrent runs of this file on the same host
// would otherwise share one ROOT, and beforeEach's recursive rm would delete the
// other run's fixtures mid-test. The random suffix makes the root per-process.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-store-test-"));

function freshStore(overrides: Partial<BundleStore> = {}): BundleStore {
  return {
    root: ROOT,
    artifactSubdir: "",
    keep: 2,
    allowlist: new Set(["docs.json", "relations.json"]),
    // Default to the in-place/marker mode so the generic cases below keep
    // exercising it; MAIN's atomic (readyCore: null) mode has its own tests.
    readyCore: "docs.json",
    requireMeta: false,
    ...overrides,
  };
}

// ROOT is already created by mkdtempSync; this only clears fixtures *between*
// tests in this file (evictLru cases read the whole root, so leftovers from a
// previous test would change what they see).
beforeEach(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(ROOT, { recursive: true });
});

afterAll(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

test("MAIN_STORE and PREVIEW_STORE are configured as documented", () => {
  expect(MAIN_STORE.artifactSubdir).toBe("");
  expect(MAIN_STORE.requireMeta).toBe(false);
  // MAIN is published atomically, so it needs no core marker — and docs.json,
  // which used to BE that marker, is no longer bundled: nothing serves or reads
  // main's per-sha copy. The browser gets the depth split instead.
  expect(MAIN_STORE.readyCore).toBeNull();
  expect(MAIN_STORE.allowlist.has("docs.json")).toBe(false);
  expect(MAIN_STORE.allowlist.has("docs-shallow.json")).toBe(true);
  expect(MAIN_STORE.allowlist.has("docs-deep.json")).toBe(true);
  expect(PREVIEW_STORE.artifactSubdir).toBe("out");
  expect(PREVIEW_STORE.requireMeta).toBe(true);
  // Preview fills its dir in place, so it still needs a real marker, and its
  // differ reads <sha>/out/docs.json.
  expect(PREVIEW_STORE.readyCore).toBe("docs.json");
  expect(PREVIEW_STORE.allowlist.has("docs.json")).toBe(true);
  expect(PREVIEW_STORE.allowlist.has("meta.json")).toBe(true);
  expect(typeof PREVIEW_DIR).toBe("string");
});

test("contentTypeFor maps extensions", () => {
  expect(contentTypeFor("docs.json")).toBe("application/json");
  expect(contentTypeFor("bundle.js")).toBe("application/javascript");
  expect(contentTypeFor("style.css")).toBe("text/css");
  expect(contentTypeFor("image.png")).toBe("application/octet-stream");
});

test("artifactPath rejects names outside the allowlist", () => {
  const store = freshStore();
  expect(artifactPath(store, "sha1", "not-allowed.json")).toBeNull();
  expect(artifactPath(store, "sha1", "docs.json")).toBe(path.join(ROOT, "sha1", "docs.json"));
});

test("artifactPath special-cases meta.json at the bundle root even with an artifactSubdir", () => {
  const store = freshStore({ artifactSubdir: "out", allowlist: new Set(["meta.json", "docs.json"]) });
  expect(artifactPath(store, "sha1", "meta.json")).toBe(path.join(ROOT, "sha1", "meta.json"));
  expect(artifactPath(store, "sha1", "docs.json")).toBe(path.join(ROOT, "sha1", "out", "docs.json"));
});

test("bundleDir joins root + sha", () => {
  const store = freshStore();
  expect(bundleDir(store, "abc")).toBe(path.join(ROOT, "abc"));
});

test("bundleReady is false until docs.json exists, and requires meta.json when configured", () => {
  const store = freshStore({ requireMeta: true });
  expect(bundleReady(store, "sha1")).toBe(false);

  fs.mkdirSync(path.join(ROOT, "sha1"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "sha1", "docs.json"), "{}");
  expect(bundleReady(store, "sha1")).toBe(false); // no meta.json yet

  fs.writeFileSync(path.join(ROOT, "sha1", "meta.json"), "{}");
  expect(bundleReady(store, "sha1")).toBe(true);
});

test("bundleReady is true with just docs.json when meta isn't required", () => {
  const store = freshStore();
  fs.mkdirSync(path.join(ROOT, "sha2"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "sha2", "docs.json"), "{}");
  expect(bundleReady(store, "sha2")).toBe(true);
});

test("touch updates mtime and silently no-ops on a missing dir", () => {
  const store = freshStore();
  fs.mkdirSync(path.join(ROOT, "sha3"), { recursive: true });
  // mkdirSync records mtime at sub-ms (ns) resolution, but touch() writes via
  // new Date(), which truncates to whole ms — so the freshly-set mtime can be a
  // sub-ms tick *below* the dir's creation mtime. Compare at ms granularity.
  const before = Math.floor(fs.statSync(path.join(ROOT, "sha3")).mtimeMs);
  touch(store, "sha3");
  expect(fs.statSync(path.join(ROOT, "sha3")).mtimeMs).toBeGreaterThanOrEqual(before);
  expect(() => touch(store, "does-not-exist")).not.toThrow();
});

test("remove deletes a bundle dir and is a no-op when it doesn't exist", () => {
  const store = freshStore();
  fs.mkdirSync(path.join(ROOT, "sha4"), { recursive: true });
  remove(store, "sha4");
  expect(fs.existsSync(path.join(ROOT, "sha4"))).toBe(false);
  expect(() => remove(store, "sha4")).not.toThrow();
});

test("evictLru sweeps unready dirs regardless of recency and keeps only the N most recent ready ones", () => {
  const store = freshStore({ keep: 1 });
  // Two ready bundles + one unready (no docs.json).
  for (const [sha, ready] of [["ready-old", true], ["ready-new", true], ["unready", false]] as const) {
    const dir = path.join(ROOT, sha);
    fs.mkdirSync(dir, { recursive: true });
    if (ready) fs.writeFileSync(path.join(dir, "docs.json"), "{}");
  }
  // Ensure ready-new sorts after ready-old by mtime.
  const past = new Date(Date.now() - 60_000);
  fs.utimesSync(path.join(ROOT, "ready-old"), past, past);

  const evicted = evictLru(store).sort();
  expect(evicted).toEqual(["ready-old", "unready"]);
  expect(fs.existsSync(path.join(ROOT, "ready-new"))).toBe(true);
  expect(fs.existsSync(path.join(ROOT, "ready-old"))).toBe(false);
  expect(fs.existsSync(path.join(ROOT, "unready"))).toBe(false);
});

test("evictLru never touches shas in the skip set", () => {
  const store = freshStore({ keep: 0 });
  fs.mkdirSync(path.join(ROOT, "in-flight"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "in-flight", "docs.json"), "{}");
  const evicted = evictLru(store, new Set(["in-flight"]));
  expect(evicted).toEqual([]);
  expect(fs.existsSync(path.join(ROOT, "in-flight"))).toBe(true);
});

test("evictLru returns [] when the store root doesn't exist", () => {
  const store = freshStore({ root: path.join(ROOT, "nope") });
  expect(evictLru(store)).toEqual([]);
});

test("publishBundle copies allowlisted artifacts + generates .gz siblings, skips missing/preview-only names", async () => {
  const srcDir = path.join(ROOT, "src");
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, "docs.json"), JSON.stringify({ hello: "world" }));
  // relations.json intentionally absent from srcDir — publishBundle should skip it, not throw.

  const store = freshStore({ allowlist: new Set(["docs.json", "relations.json", "meta.json"]) });
  await publishBundle(store, "shaX", srcDir);

  const dir = path.join(ROOT, "shaX");
  expect(fs.existsSync(path.join(dir, "docs.json"))).toBe(true);
  expect(fs.existsSync(path.join(dir, "docs.json.gz"))).toBe(true);
  expect(fs.existsSync(path.join(dir, "relations.json"))).toBe(false);
  expect(fs.existsSync(path.join(dir, "meta.json"))).toBe(false); // meta.json is publish-skipped
});

test("publishBundle prunes old bundles beyond keep (via evictLru), keeping the just-published sha", async () => {
  const srcDir = path.join(ROOT, "src2");
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, "docs.json"), "{}");

  const store = freshStore({ keep: 0 });
  // Pre-existing ready bundle that should be evicted once we publish a new one.
  fs.mkdirSync(path.join(ROOT, "old-sha"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "old-sha", "docs.json"), "{}");

  await publishBundle(store, "new-sha", srcDir);

  expect(fs.existsSync(path.join(ROOT, "new-sha", "docs.json"))).toBe(true); // kept (skip set)
  expect(fs.existsSync(path.join(ROOT, "old-sha"))).toBe(false); // evicted
});

test("serveBundleArtifact returns null for a disallowed name or a missing file", async () => {
  const store = freshStore();
  fs.mkdirSync(path.join(ROOT, "sha5"), { recursive: true });
  const req = new Request("http://x/");
  expect(await serveBundleArtifact(store, "sha5", "not-allowed.json", req)).toBeNull();
  expect(await serveBundleArtifact(store, "sha5", "docs.json", req)).toBeNull(); // allowlisted but no file
});

test("serveBundleArtifact serves the plain file when no gzip is accepted or no .gz exists", async () => {
  const store = freshStore();
  const dir = path.join(ROOT, "sha6");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "docs.json"), JSON.stringify({ a: 1 }));

  const req = new Request("http://x/"); // no accept-encoding
  const res = await serveBundleArtifact(store, "sha6", "docs.json", req, { "X-Test": "1" });
  expect(res).not.toBeNull();
  expect(res!.headers.get("content-type")).toBe("application/json");
  expect(res!.headers.get("x-test")).toBe("1");
  expect(res!.headers.get("content-encoding")).toBeNull();
  expect(await res!.json()).toEqual({ a: 1 });
});

test("serveBundleArtifact prefers the precompressed .gz when the client accepts gzip", async () => {
  const store = freshStore();
  const dir = path.join(ROOT, "sha7");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "docs.json"), "{}");
  fs.writeFileSync(path.join(dir, "docs.json.gz"), Buffer.from([0x1f, 0x8b, 0x00])); // not real gzip bytes, just needs to exist

  const req = new Request("http://x/", { headers: { "accept-encoding": "gzip, deflate" } });
  const res = await serveBundleArtifact(store, "sha7", "docs.json", req);
  expect(res).not.toBeNull();
  expect(res!.headers.get("content-encoding")).toBe("gzip");
  expect(res!.headers.get("vary")).toBe("Accept-Encoding");
});

test("bundleReady with readyCore: null treats the dir's existence as the proof", () => {
  const store = freshStore({ readyCore: null });
  expect(bundleReady(store, "atomic1")).toBe(false);
  // No docs.json anywhere — an atomically published dir is complete by
  // construction, so no single artifact has to stand in for the set.
  fs.mkdirSync(path.join(ROOT, "atomic1"), { recursive: true });
  expect(bundleReady(store, "atomic1")).toBe(true);
});

test("publishBundle is atomic: <sha> never exists until every artifact is written", async () => {
  const srcDir = path.join(ROOT, "src-atomic");
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, "docs.json"), "{}");
  fs.writeFileSync(path.join(srcDir, "relations.json"), "{}");

  const store = freshStore({ readyCore: null });
  const finalDir = path.join(ROOT, "shaAtomic");
  const realWrite = fs.writeFileSync;
  const seen: boolean[] = [];
  // Probe from inside the artifact loop rather than off a timer: this runs
  // synchronously on every write, so the observation can't be scheduled away
  // on a fast machine. The final dir must stay invisible until the rename.
  (fs as { writeFileSync: typeof fs.writeFileSync }).writeFileSync = ((...args: Parameters<typeof fs.writeFileSync>) => {
    seen.push(fs.existsSync(finalDir));
    return realWrite(...args);
  }) as typeof fs.writeFileSync;
  try {
    await publishBundle(store, "shaAtomic", srcDir);
  } finally {
    (fs as { writeFileSync: typeof fs.writeFileSync }).writeFileSync = realWrite;
  }

  expect(seen.length).toBe(4); // 2 artifacts × (.json + .gz)
  expect(seen.some(Boolean)).toBe(false); // never observed mid-publish
  for (const n of ["docs.json", "docs.json.gz", "relations.json", "relations.json.gz"]) {
    expect(fs.existsSync(path.join(ROOT, "shaAtomic", n))).toBe(true);
  }
  expect(fs.existsSync(path.join(ROOT, ".tmp-shaAtomic"))).toBe(false); // stage renamed away
});

test("publishBundle leaves an already-published sha alone but still touches + prunes", async () => {
  const srcDir = path.join(ROOT, "src-idem");
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, "docs.json"), JSON.stringify({ v: 2 }));

  const store = freshStore({ readyCore: null, keep: 0 });
  // A bundle's bytes are fixed by its sha, so an existing dir is authoritative:
  // republishing must not rewrite it (that is what makes the retry path cheap).
  fs.mkdirSync(path.join(ROOT, "shaIdem"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "shaIdem", "docs.json"), JSON.stringify({ v: 1 }));
  fs.mkdirSync(path.join(ROOT, "other-sha"), { recursive: true });

  await publishBundle(store, "shaIdem", srcDir);

  expect(JSON.parse(fs.readFileSync(path.join(ROOT, "shaIdem", "docs.json"), "utf8"))).toEqual({ v: 1 });
  expect(fs.existsSync(path.join(ROOT, "shaIdem", "docs.json.gz"))).toBe(false); // not rewritten
  expect(fs.existsSync(path.join(ROOT, "other-sha"))).toBe(false); // pruning still ran
});

test("publishBundle removes its staging dir when a write fails, so a retry can't publish a partial bundle", async () => {
  const srcDir = path.join(ROOT, "src-fail");
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, "docs.json"), "{}");
  fs.writeFileSync(path.join(srcDir, "relations.json"), "{}");

  const store = freshStore({ readyCore: null });
  const realWrite = fs.writeFileSync;
  let writes = 0;
  // Fail partway through the artifact loop, after at least one file landed.
  (fs as { writeFileSync: typeof fs.writeFileSync }).writeFileSync = ((...args: Parameters<typeof fs.writeFileSync>) => {
    if (++writes === 3) throw new Error("disk full");
    return realWrite(...args);
  }) as typeof fs.writeFileSync;
  try {
    await expect(publishBundle(store, "shaFail", srcDir)).rejects.toThrow("disk full");
  } finally {
    (fs as { writeFileSync: typeof fs.writeFileSync }).writeFileSync = realWrite;
  }

  expect(fs.existsSync(path.join(ROOT, "shaFail"))).toBe(false);
  expect(fs.existsSync(path.join(ROOT, ".tmp-shaFail"))).toBe(false);
});

test("evictLru sweeps a leftover staging dir instead of counting it as a ready bundle", () => {
  const store = freshStore({ readyCore: null, keep: 5 });
  fs.mkdirSync(path.join(ROOT, ".tmp-crashed"), { recursive: true });
  fs.mkdirSync(path.join(ROOT, "real-sha"), { recursive: true });

  const evicted = evictLru(store);
  expect(evicted).toEqual([".tmp-crashed"]);
  expect(fs.existsSync(path.join(ROOT, ".tmp-crashed"))).toBe(false);
  expect(fs.existsSync(path.join(ROOT, "real-sha"))).toBe(true); // under keep, retained
});

test("publishBundle refuses to publish an empty bundle rather than making an unservable sha ready", async () => {
  const srcDir = path.join(ROOT, "src-empty");
  fs.mkdirSync(srcDir, { recursive: true }); // no artifacts at all
  const store = freshStore({ readyCore: null });

  await expect(publishBundle(store, "shaEmpty", srcDir)).rejects.toThrow(/no artifacts/);
  expect(fs.existsSync(path.join(ROOT, "shaEmpty"))).toBe(false);
  expect(fs.existsSync(path.join(ROOT, ".tmp-shaEmpty"))).toBe(false);
});
