// previews table access (src/server/preview/db.ts). Mocks the shared ../db.ts
// sql tag — same pattern as src/server/auth.test.ts — so no real Postgres
// connection is attempted. The stub records every query call so assertions can
// check which branch ran, and returns a queued response per call.
import { test, expect, mock, beforeEach, afterAll } from "bun:test";

let queued: unknown[] = [];
let calls: { strings: readonly string[]; values: unknown[] }[] = [];

mock.module("../db.ts", () => ({
  sql(strings: TemplateStringsArray, ...values: unknown[]) {
    calls.push({ strings: [...strings], values });
    return Promise.resolve(queued.shift() ?? []);
  },
  dbTarget: () => "mock-db",
  waitForDb: () => Promise.resolve(),
  toVectorLiteral: (vec: number[]) => `[${vec.join(",")}]`,
  toUuidArrayLiteral: (ids: readonly string[]) => `{${ids.join(",")}}`,
  fromUuidArray: (v: unknown) => Array.isArray(v) ? v.map(String) : [],
}));

const {
  upsertPreview,
  getPreviewRow,
  isKnownSha,
  touchPreview,
  previewsTodayCount,
  previewsTodayCountForOwner,
  previewsTodayCountForRepo,
  listPreviews,
  isBlockedSha,
  blockedShas,
} = await import("./db.ts");

// Restore mock.module (../db.ts) so it doesn't leak into sibling test files
// sharing the single `bun test src/server` process.
afterAll(() => mock.restore());

beforeEach(() => {
  queued = [];
  calls = [];
});

test("upsertPreview issues an INSERT ... ON CONFLICT with the meta fields", async () => {
  queued.push([]);
  await upsertPreview({
    sha: "s1",
    repo: "sky-ecosystem/next-gen-atlas",
    ref: "pull-1",
    kind: "pr",
    prNumber: 1,
    prTitle: "Title",
    prAuthor: "bob",
    prState: "open",
    resolvedAt: "t",
    docCount: 3,
    buildMs: 100,
    trustTier: "trusted",
  } as any);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.strings.join("")).toContain("INSERT INTO previews");
  expect(calls[0]!.values).toContain("s1");
  expect(calls[0]!.values).toContain("trusted");
});

test("upsertPreview defaults optional fields to null", async () => {
  queued.push([]);
  await upsertPreview({
    sha: "s2",
    repo: "r",
    ref: "main",
    kind: "branch",
    resolvedAt: "t",
    docCount: 0,
    buildMs: 1,
  } as any);
  expect(calls[0]!.values).toContain(null);
});

test("getPreviewRow returns the row, or null when unknown", async () => {
  queued.push([{ sha: "s1", repo: "r" }]);
  expect(await getPreviewRow("s1")).toEqual({ sha: "s1", repo: "r" } as any);
  queued.push([]);
  expect(await getPreviewRow("nope")).toBeNull();
});

test("isKnownSha true/false from row presence", async () => {
  queued.push([{ "?column?": 1 }]);
  expect(await isKnownSha("s1")).toBe(true);
  queued.push([]);
  expect(await isKnownSha("nope")).toBe(false);
});

test("touchPreview issues an UPDATE", async () => {
  queued.push([]);
  await touchPreview("s1");
  expect(calls[0]!.strings.join("")).toContain("UPDATE previews SET last_access");
});

test("previewsTodayCount: canonical pool uses the NULL/trusted-PR predicate", async () => {
  queued.push([{ n: 7 }]);
  expect(await previewsTodayCount("canonical")).toBe(7);
  expect(calls[0]!.strings.join("")).toContain("trust_tier IS NULL");
});

test("previewsTodayCount: known/unknown pools filter on trust_tier", async () => {
  queued.push([{ n: 2 }]);
  expect(await previewsTodayCount("known")).toBe(2);
  expect(calls[0]!.values).toContain("known");

  queued.push([{ n: 0 }]);
  expect(await previewsTodayCount("unknown")).toBe(0);
});

test("previewsTodayCount defaults to 0 when no row comes back", async () => {
  queued.push([]);
  expect(await previewsTodayCount("canonical")).toBe(0);
});

test("previewsTodayCountForOwner scopes to trusted fork previews for that owner", async () => {
  queued.push([{ n: 3 }]);
  expect(await previewsTodayCountForOwner("blimpa")).toBe(3);
  expect(calls[0]!.values).toContain("blimpa/");
});

test("previewsTodayCountForRepo scopes to that repo's private previews today", async () => {
  queued.push([{ n: 4 }]);
  expect(await previewsTodayCountForRepo("acme/atlas-fork")).toBe(4);
  expect(calls[0]!.values).toContain("acme/atlas-fork");
  expect(calls[0]!.strings.join("")).toContain("private = true");
});

test("previewsTodayCountForRepo defaults to 0 when no row comes back", async () => {
  queued.push([]);
  expect(await previewsTodayCountForRepo("acme/atlas-fork")).toBe(0);
});

test("listPreviews returns rows, limit defaults to 50", async () => {
  queued.push([{ sha: "s1" }, { sha: "s2" }]);
  const rows = await listPreviews();
  expect(rows).toHaveLength(2);
  expect(calls[0]!.values).toContain(50);
});

test("listPreviews excludes private rows", async () => {
  queued.push([]);
  await listPreviews();
  expect(calls[0]!.strings.join("")).toContain("private = false");
});

test("listPreviews respects an explicit limit", async () => {
  queued.push([]);
  await listPreviews(5);
  expect(calls[0]!.values).toContain(5);
});

test("isBlockedSha true/false", async () => {
  queued.push([{ "?column?": 1 }]);
  expect(await isBlockedSha("s1")).toBe(true);
  queued.push([]);
  expect(await isBlockedSha("s2")).toBe(false);
});

test("blockedShas returns a Set of blocked shas", async () => {
  queued.push([{ sha: "a" }, { sha: "b" }]);
  const set = await blockedShas();
  expect(set).toEqual(new Set(["a", "b"]));
});
