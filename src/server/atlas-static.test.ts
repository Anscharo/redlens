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
import { gzipSync, gunzipSync } from "node:zlib";
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

// ---------------------------------------------------------------------------
// Local-miss hydration (docs/plans/atlas-artifact-store.md phase 2). The fetcher
// is injected, so these run with no database: a fake returns the sha's blobs the
// way atlas-artifacts.ts will. HYDRATE_SHA is never written by the fixtures
// above — the point is that this container has never seen it.
// ---------------------------------------------------------------------------
const HYDRATE_SHA = "b".repeat(40);
const PRUNED_SHA = "c".repeat(40);
const REAL_KEEP = MAIN_STORE.keep;

beforeAll(() => {
  // The hydrate path prunes like a publish. Raise retention for this file so a
  // hydrated bundle can't evict the fixture bundle the tests above depend on.
  MAIN_STORE.keep = 50;
});
afterAll(() => {
  MAIN_STORE.keep = REAL_KEEP;
});

function blobs(entries: Array<[string, unknown]>) {
  return entries.map(([name, value]) => ({ name, gz: gzipSync(Buffer.from(JSON.stringify(value))) }));
}

/** Fake artifact store over a fixed blob set, counting fetches. */
function fakeFetch(entries: Array<[string, unknown]>, delayMs = 0) {
  const items = blobs(entries);
  const f = async (sha: string) => {
    f.calls++;
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    return sha === HYDRATE_SHA ? items : [];
  };
  f.calls = 0;
  return f;
}

test("a local miss hydrates from the artifact store and serves the artifact", async () => {
  const fetch = fakeFetch([
    ["docs-shallow.json", { hello: "from-store" }],
    ["relations.json", []],
  ]);
  const p = `/api/atlas/${HYDRATE_SHA}/docs-shallow.json`;
  const res = await handleAtlasStatic(req(p), p, fetch);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ hello: "from-store" });
  expect(fetch.calls).toBe(1);

  // A second request is a local hit: no store round-trip, and the sibling
  // artifact from the same hydrate is already there too.
  const res2 = await handleAtlasStatic(req(p), p, fetch);
  expect(res2.status).toBe(200);
  const sib = `/api/atlas/${HYDRATE_SHA}/relations.json`;
  expect((await handleAtlasStatic(req(sib), sib, fetch)).status).toBe(200);
  expect(fetch.calls).toBe(1);
});

test("a gzip-accepting client gets the .gz sibling after a hydrate", async () => {
  // Same sha as above — already on disk — so this pins that hydration kept the
  // precompressed sibling, not just the flat file.
  const p = `/api/atlas/${HYDRATE_SHA}/docs-shallow.json`;
  const res = await handleAtlasStatic(req(p, { "accept-encoding": "gzip, deflate" }), p, fakeFetch([]));
  expect(res.status).toBe(200);
  expect(res.headers.get("content-encoding")).toBe("gzip");
  expect(res.headers.get("vary")).toBe("Accept-Encoding");
  expect(gunzipSync(Buffer.from(await res.arrayBuffer())).toString()).toBe(JSON.stringify({ hello: "from-store" }));
});

test("a sha the store has nothing for is still a 404 (genuinely pruned)", async () => {
  const fetch = fakeFetch([["docs-shallow.json", {}]]); // only answers for HYDRATE_SHA
  const p = `/api/atlas/${PRUNED_SHA}/docs-shallow.json`;
  expect((await handleAtlasStatic(req(p), p, fetch)).status).toBe(404);
  expect(fetch.calls).toBe(1);
  expect(fs.existsSync(bundleDir(MAIN_STORE, PRUNED_SHA))).toBe(false);
});

test("a non-allowlisted name on a miss 404s without touching the artifact store", async () => {
  const fetch = fakeFetch([["docs-shallow.json", {}]]);
  const p = `/api/atlas/${HYDRATE_SHA}/not-allowed.json`;
  expect((await handleAtlasStatic(req(p), p, fetch)).status).toBe(404);
  expect(fetch.calls).toBe(0);
});

test("a burst of requests for one cold sha downloads it exactly once", async () => {
  const burstSha = HYDRATE_SHA; // reuse the fixture's blob set via a fresh fetcher
  fs.rmSync(bundleDir(MAIN_STORE, burstSha), { recursive: true, force: true });
  const fetch = fakeFetch(
    [
      ["docs-shallow.json", { hello: "burst" }],
      ["docs-deep.json", {}],
      ["relations.json", []],
    ],
    10,
  );
  const names = ["docs-shallow.json", "docs-deep.json", "relations.json", "docs-shallow.json", "glossary.json"];
  const results = await Promise.all(
    names.map((n) => {
      const p = `/api/atlas/${burstSha}/${n}`;
      return handleAtlasStatic(req(p), p, fetch);
    }),
  );
  expect(fetch.calls).toBe(1);
  // glossary.json wasn't in the published set — still a 404 after the hydrate.
  expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 404]);
});

test("the default fetcher is a no-op, so an unwired miss stays a 404 exactly as before", async () => {
  const p = `/api/atlas/${"d".repeat(40)}/docs-shallow.json`;
  expect((await handleAtlasStatic(req(p), p)).status).toBe(404);
});
