// bundle-store.ts unit tests. Pure filesystem logic; runs against custom
// BundleStore objects rooted in the scratchpad tmp dir rather than
// MAIN_STORE/PREVIEW_STORE (those are tied to real config paths and used by
// atlas-static.test.ts against the actual public/atlas dir) — keeps the two
// test files' fixtures independent.
import { test, expect, beforeEach, afterAll } from "bun:test";
import fs from "node:fs";
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

const ROOT = path.join(
  "/tmp/claude-0/-home-user-redlens/a7bb03e6-a312-5c73-91a4-438dea3f7e47/scratchpad",
  "bundle-store-test",
);

function freshStore(overrides: Partial<BundleStore> = {}): BundleStore {
  return {
    root: ROOT,
    artifactSubdir: "",
    keep: 2,
    allowlist: new Set(["docs.json", "relations.json"]),
    requireMeta: false,
    ...overrides,
  };
}

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
  expect(MAIN_STORE.allowlist.has("docs.json")).toBe(true);
  expect(PREVIEW_STORE.artifactSubdir).toBe("out");
  expect(PREVIEW_STORE.requireMeta).toBe(true);
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
  const before = fs.statSync(path.join(ROOT, "sha3")).mtimeMs;
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
