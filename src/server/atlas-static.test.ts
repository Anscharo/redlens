// atlas-static.ts unit tests. Exercises the real MAIN_STORE (rooted at
// config.atlasBundleRoot, i.e. public/atlas) — writes a throwaway per-sha
// bundle dir under it for the "found" cases and removes it afterward so no
// test fixture is left behind. The 404 paths (bad segment count, bad sha
// shape, disallowed/missing artifact) need no filesystem setup at all.
import { test, expect, beforeAll, afterAll } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { handleAtlasStatic } from "./atlas-static.ts";
import { MAIN_STORE, bundleDir } from "./bundle-store.ts";

// A syntactically valid sha (40 hex chars) that will never collide with a real
// atlas commit in this run.
const TEST_SHA = "f".repeat(40);
const DIR = bundleDir(MAIN_STORE, TEST_SHA);

beforeAll(() => {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, "docs.json"), JSON.stringify({ hello: "atlas" }));
});

afterAll(() => {
  fs.rmSync(DIR, { recursive: true, force: true });
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
  const res = await handleAtlasStatic(req("/api/atlas/not-a-sha/docs.json"), "/api/atlas/not-a-sha/docs.json");
  expect(res.status).toBe(404);
});

test("accepts an uppercase sha (case-insensitive) and lowercases it for lookup", async () => {
  const upper = TEST_SHA.toUpperCase();
  const res = await handleAtlasStatic(req(`/api/atlas/${upper}/docs.json`), `/api/atlas/${upper}/docs.json`);
  expect(res.status).toBe(200);
});

test("404 when the artifact name isn't allowlisted", async () => {
  const p = `/api/atlas/${TEST_SHA}/not-allowed.json`;
  const res = await handleAtlasStatic(req(p), p);
  expect(res.status).toBe(404);
});

test("404 when the sha bundle dir/artifact doesn't exist", async () => {
  const missingSha = "a".repeat(40);
  const p = `/api/atlas/${missingSha}/docs.json`;
  const res = await handleAtlasStatic(req(p), p);
  expect(res.status).toBe(404);
});

test("200 with the immutable cache-control header when the artifact exists", async () => {
  const p = `/api/atlas/${TEST_SHA}/docs.json`;
  const res = await handleAtlasStatic(req(p), p);
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  expect(await res.json()).toEqual({ hello: "atlas" });
});
