// bundle-store.ts unit tests. Pure filesystem logic; runs against custom
// BundleStore objects rooted in a throwaway temp dir rather than
// MAIN_STORE/PREVIEW_STORE (those are tied to real config paths) — keeps this
// file's fixtures independent of the real public/atlas tree and of every other
// test file.
import { test, expect, beforeEach, afterEach, afterAll } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import {
  artifactPath,
  bundleDir,
  bundleReady,
  contentTypeFor,
  evictLru,
  hydrateBundleFromStore,
  pinBundleSha,
  pinnedBundleSha,
  publishBundle,
  remove,
  serveBundleArtifact,
  touch,
  type BundleStore,
  MAIN_STORE,
  PREVIEW_STORE,
  PREVIEW_DIR,
  PUBLISHED_ARTIFACTS,
} from "./bundle-store.ts";
// The worker profile is the publisher; this file asserts the two agree.
import { stepsFor } from "../../scripts/lib/build-steps.mjs";

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

// ---------------------------------------------------------------------------
// hydrateBundleFromStore — the serve-path fallback (docs/plans/atlas-artifact-store.md
// phase 2). Exercised against a FAKE fetcher: the real one reads Postgres, and
// none of this logic depends on where the blobs came from.
// ---------------------------------------------------------------------------

function blob(name: string, value: unknown): { name: string; gz: Buffer } {
  return { name, gz: gzipSync(Buffer.from(JSON.stringify(value))) };
}

/** A fetcher over a fixed blob set that counts how many times it was called. */
function fakeFetch(items: Array<{ name: string; gz: Buffer }>, delayMs = 0) {
  const f = async (_sha: string) => {
    f.calls++;
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    return items;
  };
  f.calls = 0;
  return f;
}

test("hydrateBundleFromStore writes the flat .json AND its .gz sibling for every allowlisted blob", async () => {
  const store = freshStore({ readyCore: null, keep: 5 });
  const fetch = fakeFetch([
    blob("docs.json", { hello: "hydrated" }),
    blob("relations.json", []),
    // Not allowlisted by this store: hydrating it would write a file the store
    // would refuse to serve.
    blob("secrets.json", { nope: true }),
  ]);

  expect(await hydrateBundleFromStore(store, "shaHyd", fetch)).toBe(true);
  expect(fetch.calls).toBe(1);

  const dir = path.join(ROOT, "shaHyd");
  expect(JSON.parse(fs.readFileSync(path.join(dir, "docs.json"), "utf8"))).toEqual({ hello: "hydrated" });
  // The .gz must survive the round-trip: serveBundleArtifact prefers it, so a
  // flat-only hydrate would silently drop compression for every client.
  expect(gunzipSync(fs.readFileSync(path.join(dir, "docs.json.gz"))).toString()).toBe(
    JSON.stringify({ hello: "hydrated" }),
  );
  expect(fs.existsSync(path.join(dir, "relations.json.gz"))).toBe(true);
  expect(fs.existsSync(path.join(dir, "secrets.json"))).toBe(false);
  expect(bundleReady(store, "shaHyd")).toBe(true);
});

test("hydrateBundleFromStore serves gzip afterwards (the .gz is preferred, and is real gzip)", async () => {
  const store = freshStore({ readyCore: null, keep: 5 });
  await hydrateBundleFromStore(store, "shaGz", fakeFetch([blob("docs.json", { a: 1 })]));

  const req = new Request("http://x/", { headers: { "accept-encoding": "gzip" } });
  const res = await serveBundleArtifact(store, "shaGz", "docs.json", req);
  expect(res!.headers.get("content-encoding")).toBe("gzip");
  expect(gunzipSync(Buffer.from(await res!.arrayBuffer())).toString()).toBe(JSON.stringify({ a: 1 }));
});

test("hydrateBundleFromStore returns false for a sha the store has nothing for, leaving no dir or stage", async () => {
  const store = freshStore({ readyCore: null, keep: 5 });
  const fetch = fakeFetch([]);
  expect(await hydrateBundleFromStore(store, "shaPruned", fetch)).toBe(false);
  expect(fetch.calls).toBe(1);
  expect(fs.existsSync(path.join(ROOT, "shaPruned"))).toBe(false);
  expect(fs.existsSync(path.join(ROOT, ".tmp-shaPruned"))).toBe(false);
});

test("hydrateBundleFromStore short-circuits on a bundle already on disk — no second fetch", async () => {
  const store = freshStore({ readyCore: null, keep: 5 });
  const fetch = fakeFetch([blob("docs.json", { v: 1 })]);
  expect(await hydrateBundleFromStore(store, "shaTwice", fetch)).toBe(true);
  expect(await hydrateBundleFromStore(store, "shaTwice", fetch)).toBe(true);
  expect(fetch.calls).toBe(1); // second request hit local disk
});

test("concurrent hydrates of one sha download exactly once", async () => {
  const store = freshStore({ readyCore: null, keep: 5 });
  const fetch = fakeFetch([blob("docs.json", { v: 1 })], 10);
  // A cold instance takes the whole burst of one page load at once.
  const results = await Promise.all([1, 2, 3, 4, 5].map(() => hydrateBundleFromStore(store, "shaBurst", fetch)));
  expect(results).toEqual([true, true, true, true, true]);
  expect(fetch.calls).toBe(1);
});

test("concurrent hydrates of different shas do not sweep each other's staging dirs", async () => {
  // The crawler case is many COLD shas at once, not five requests for one.
  // Each hydrate's evictLru used to treat every `.tmp-*` dir as crash garbage
  // and delete in-flight siblings — the first to finish aborted the rest
  // (caught, returned false), so a burst of old indexed URLs 404'd.
  const store = freshStore({ readyCore: null, keep: 5 });
  const fetches = ["shaA", "shaB", "shaC"].map((sha) => ({
    sha,
    fetch: fakeFetch([blob("docs.json", { sha })], 20),
  }));
  const results = await Promise.all(fetches.map(({ sha, fetch }) => hydrateBundleFromStore(store, sha, fetch)));
  expect(results).toEqual([true, true, true]);
  for (const { sha } of fetches) {
    expect(JSON.parse(fs.readFileSync(path.join(ROOT, sha, "docs.json"), "utf8"))).toEqual({ sha });
    expect(fs.existsSync(path.join(ROOT, `.tmp-${sha}`))).toBe(false);
  }
});

test("hydrateBundleFromStore is atomic: <sha> never exists until every blob is written", async () => {
  const store = freshStore({ readyCore: null, keep: 5 });
  const finalDir = path.join(ROOT, "shaHydAtomic");
  const realWrite = fs.writeFileSync;
  const seen: boolean[] = [];
  (fs as { writeFileSync: typeof fs.writeFileSync }).writeFileSync = ((...args: Parameters<typeof fs.writeFileSync>) => {
    seen.push(fs.existsSync(finalDir));
    return realWrite(...args);
  }) as typeof fs.writeFileSync;
  try {
    await hydrateBundleFromStore(store, "shaHydAtomic", fakeFetch([blob("docs.json", {}), blob("relations.json", [])]));
  } finally {
    (fs as { writeFileSync: typeof fs.writeFileSync }).writeFileSync = realWrite;
  }

  expect(seen.length).toBe(4); // 2 artifacts × (.json + .gz)
  expect(seen.some(Boolean)).toBe(false); // never observed mid-hydrate
  expect(fs.existsSync(path.join(ROOT, ".tmp-shaHydAtomic"))).toBe(false);
  expect(fs.existsSync(path.join(finalDir, "relations.json.gz"))).toBe(true);
});

test("hydrateBundleFromStore resolves false (never rejects) when the fetcher throws, and leaves no stage", async () => {
  const store = freshStore({ readyCore: null, keep: 5 });
  const boom = async () => {
    throw new Error("db down");
  };
  expect(await hydrateBundleFromStore(store, "shaBoom", boom)).toBe(false);
  expect(fs.existsSync(path.join(ROOT, "shaBoom"))).toBe(false);
  expect(fs.existsSync(path.join(ROOT, ".tmp-shaBoom"))).toBe(false);
  // …and a later attempt is free to retry: the failure isn't cached.
  const fetch = fakeFetch([blob("docs.json", { v: 1 })]);
  expect(await hydrateBundleFromStore(store, "shaBoom", fetch)).toBe(true);
});

test("hydrateBundleFromStore resolves false on a corrupt blob rather than publishing garbage", async () => {
  const store = freshStore({ readyCore: null, keep: 5 });
  const bad = async () => [{ name: "docs.json", gz: Buffer.from("not gzip at all") }];
  expect(await hydrateBundleFromStore(store, "shaBad", bad)).toBe(false);
  expect(fs.existsSync(path.join(ROOT, "shaBad"))).toBe(false);
  expect(fs.existsSync(path.join(ROOT, ".tmp-shaBad"))).toBe(false);
});

test("hydrateBundleFromStore prunes like a publish, keeping the sha it just hydrated", async () => {
  const store = freshStore({ readyCore: null, keep: 0 });
  fs.mkdirSync(path.join(ROOT, "old-sha"), { recursive: true });

  expect(await hydrateBundleFromStore(store, "shaFresh", fakeFetch([blob("docs.json", {})]))).toBe(true);
  expect(fs.existsSync(path.join(ROOT, "shaFresh", "docs.json"))).toBe(true); // kept (skip set)
  expect(fs.existsSync(path.join(ROOT, "old-sha"))).toBe(false); // evicted
});

// ---------------------------------------------------------------------------
// Pinned live sha. evictLru is least-recently-WRITTEN (nothing stamps mtime on
// serve), so once hydration can be triggered by a plain GET, requests for old
// indexed sha URLs would push the live bundle out of the keep window. The pin
// is module-level state, so every test here restores it.
// ---------------------------------------------------------------------------

afterEach(() => pinBundleSha(null));

test("pinBundleSha round-trips and lowercases; null unpins", () => {
  expect(pinnedBundleSha()).toBeNull();
  pinBundleSha("ABCDEF");
  expect(pinnedBundleSha()).toBe("abcdef");
  pinBundleSha(null);
  expect(pinnedBundleSha()).toBeNull();
});

test("evictLru never removes the pinned sha, even as the oldest bundle beyond keep", () => {
  const store = freshStore({ readyCore: null, keep: 1 });
  for (const sha of ["live", "cold-a", "cold-b"]) fs.mkdirSync(path.join(ROOT, sha), { recursive: true });
  // Make the pinned bundle the LEAST recently written — exactly the live sha's
  // situation after a few hydrates stamp now() on cold bundles. cold-a/cold-b
  // get distinct mtimes too: created in the same millisecond, their relative
  // order would otherwise be arbitrary.
  for (const [sha, agoMs] of [["live", 60_000], ["cold-a", 30_000]] as const) {
    const t = new Date(Date.now() - agoMs);
    fs.utimesSync(path.join(ROOT, sha), t, t);
  }

  pinBundleSha("live");
  const evicted = evictLru(store).sort();
  expect(evicted).toEqual(["cold-a"]); // cold-b is the one kept by keep:1
  expect(fs.existsSync(path.join(ROOT, "live"))).toBe(true);
});

test("evictLru with nothing pinned behaves exactly as before", () => {
  const store = freshStore({ readyCore: null, keep: 1 });
  for (const sha of ["live", "cold-a"]) fs.mkdirSync(path.join(ROOT, sha), { recursive: true });
  const past = new Date(Date.now() - 60_000);
  fs.utimesSync(path.join(ROOT, "live"), past, past);

  expect(pinnedBundleSha()).toBeNull();
  expect(evictLru(store)).toEqual(["live"]); // oldest, unprotected
});

test("a burst of cold-sha hydrates cannot evict the pinned live bundle", async () => {
  // The crawler case: /api/atlas/<sha>/* is immutable AND indexable, so old sha
  // URLs are walkable, and each miss hydrates + stamps a fresh mtime.
  const store = freshStore({ readyCore: null, keep: 1 });
  fs.mkdirSync(path.join(ROOT, "live-sha"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "live-sha", "docs.json"), JSON.stringify({ live: true }));
  pinBundleSha("live-sha");

  for (const cold of ["cold-1", "cold-2", "cold-3", "cold-4"]) {
    expect(await hydrateBundleFromStore(store, cold, fakeFetch([blob("docs.json", { cold })]))).toBe(true);
  }

  expect(JSON.parse(fs.readFileSync(path.join(ROOT, "live-sha", "docs.json"), "utf8"))).toEqual({ live: true });
  // The cold bundles still churn against each other under keep:1 — the pin
  // protects the live sha, it does not widen the retention window. Asserted by
  // count, not by name: hydrates land inside the same millisecond, so which of
  // two equally-aged cold bundles loses the tie is arbitrary. cold-4 is exact,
  // though — a hydrate always skips the sha it just wrote.
  const cold = fs.readdirSync(ROOT).filter((d) => d.startsWith("cold-"));
  expect(cold).toContain("cold-4");
  expect(cold.length).toBeLessThanOrEqual(2); // keep:1 + the just-hydrated sha
});

test("publishBundle's prune also honours the pin", async () => {
  const srcDir = path.join(ROOT, "src-pin");
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, "docs.json"), "{}");

  const store = freshStore({ readyCore: null, keep: 0 });
  fs.mkdirSync(path.join(ROOT, "live-sha"), { recursive: true });
  fs.mkdirSync(path.join(ROOT, "other-sha"), { recursive: true });
  pinBundleSha("live-sha");

  await publishBundle(store, "new-sha", srcDir);
  expect(fs.existsSync(path.join(ROOT, "live-sha"))).toBe(true); // pinned
  expect(fs.existsSync(path.join(ROOT, "other-sha"))).toBe(false); // evicted
});

test("PUBLISHED_ARTIFACTS is the served set plus graph.json, and never docs.json", () => {
  // Derived, not hand-kept: a name added to MAIN_ALLOWLIST is published without
  // anyone remembering to. graph.json is the one addition — never served, but
  // the indexes need it and rebuilding it is the expensive step phase 4 moves
  // off the web instance.
  for (const name of MAIN_STORE.allowlist) expect(PUBLISHED_ARTIFACTS).toContain(name);
  expect(PUBLISHED_ARTIFACTS).toContain("graph.json");
  expect(PUBLISHED_ARTIFACTS).not.toContain("docs.json");
  expect(new Set(PUBLISHED_ARTIFACTS).size).toBe(PUBLISHED_ARTIFACTS.length);
});

test("every published artifact is produced by a step the atlas worker actually runs", () => {
  // The worker is the sole publisher, so a published name it does not build is
  // a file web instances would ask for and never get — and it would only
  // surface as a 404 in a browser. Declaring the producer here means adding an
  // artifact fails this test until someone says which step makes it.
  const PRODUCER: Record<string, string> = {
    "docs-shallow.json": "index",
    "docs-deep.json": "index",
    "search-index.json": "index",
    "addresses.atlas.json": "index",
    "relations.json": "graph",
    "graph.json": "graph",
    "glossary.json": "glossary",
    "oea-report.json": "oea-report",
  };
  const workerSteps = new Set(stepsFor("worker").map((s: { id: string }) => s.id));
  for (const name of PUBLISHED_ARTIFACTS) {
    const producer = PRODUCER[name];
    expect(producer, `${name} is published but no producing step is declared`).toBeDefined();
    expect(workerSteps, `${name} is published but the worker profile never runs "${producer}"`).toContain(producer);
  }
});
