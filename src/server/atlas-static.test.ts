// atlas-static.ts unit tests. handleAtlasStatic hardcodes MAIN_STORE (no store
// parameter to inject through), so instead of writing fixtures into the REAL
// bundle root (config.atlasBundleRoot, i.e. public/atlas — where a parallel test
// run or the updater's LRU sweeper could delete them mid-test) we repoint
// MAIN_STORE.root at a per-process temp dir for the life of this file and
// restore it afterward. bundleDir/artifactPath read .root at call time, so the
// swap is enough; bun runs test files sequentially in a process, so no other
// file observes the swapped root. The 404 paths (bad segment count, bad sha
// shape, disallowed/missing artifact) need no filesystem setup at all.
import { test, expect, beforeAll, afterAll } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { handleAtlasStatic } from "./atlas-static.ts";
import { MAIN_STORE, bundleDir } from "./bundle-store.ts";

// A syntactically valid sha (40 hex chars) that will never collide with a real
// atlas commit.
const TEST_SHA = "f".repeat(40);
const REAL_ROOT = MAIN_STORE.root;
let tmpRoot = "";

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-static-test-"));
  MAIN_STORE.root = tmpRoot;
  const dir = bundleDir(MAIN_STORE, TEST_SHA);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "docs-shallow.json"), JSON.stringify({ hello: "atlas" }));
  // Written but NOT allowlisted for main — the case below pins that a file
  // sitting in the bundle dir is still refused when the store won't serve it.
  fs.writeFileSync(path.join(dir, "docs.json"), JSON.stringify({ hello: "unreachable" }));
});

afterAll(() => {
  MAIN_STORE.root = REAL_ROOT;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function req(pathname: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://x${pathname}`, { headers });
}

test("404 when the path doesn't have exactly sha/name segments", async () => {
  expect((await handleAtlasStatic(req("/api/atlas/"), "/api/atlas/")).status).toBe(404);
  expect((await handleAtlasStatic(req(`/api/atlas/${TEST_SHA}`), `/api/atlas/${TEST_SHA}`)).status).toBe(404);
  expect(
    (await handleAtlasStatic(req(`/api/atlas/${TEST_SHA}/a/b`), `/api/atlas/${TEST_SHA}/a/b`)).status,
  ).toBe(404);
});

test("404 when the sha segment isn't 40 hex chars", async () => {
  const res = await handleAtlasStatic(req("/api/atlas/not-a-sha/docs-shallow.json"), "/api/atlas/not-a-sha/docs-shallow.json");
  expect(res.status).toBe(404);
});

test("accepts an uppercase sha (case-insensitive) and lowercases it for lookup", async () => {
  const upper = TEST_SHA.toUpperCase();
  const res = await handleAtlasStatic(req(`/api/atlas/${upper}/docs-shallow.json`), `/api/atlas/${upper}/docs-shallow.json`);
  expect(res.status).toBe(200);
});

test("404 when the artifact name isn't allowlisted", async () => {
  const p = `/api/atlas/${TEST_SHA}/not-allowed.json`;
  const res = await handleAtlasStatic(req(p), p);
  expect(res.status).toBe(404);
});

test("404 when the sha bundle dir/artifact doesn't exist", async () => {
  const missingSha = "a".repeat(40);
  const p = `/api/atlas/${missingSha}/docs-shallow.json`;
  const res = await handleAtlasStatic(req(p), p);
  expect(res.status).toBe(404);
});

test("200 with the immutable cache-control header when the artifact exists", async () => {
  const p = `/api/atlas/${TEST_SHA}/docs-shallow.json`;
  const res = await handleAtlasStatic(req(p), p);
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  expect(await res.json()).toEqual({ hello: "atlas" });
});

test("404 for docs.json even when the file is in the bundle dir — main doesn't serve it", async () => {
  // The browser fetches the docs-shallow/docs-deep split; main stopped bundling
  // docs.json, and the allowlist must refuse it regardless of what is on disk.
  const p = `/api/atlas/${TEST_SHA}/docs.json`;
  expect(fs.existsSync(path.join(bundleDir(MAIN_STORE, TEST_SHA), "docs.json"))).toBe(true);
  expect((await handleAtlasStatic(req(p), p)).status).toBe(404);
});
