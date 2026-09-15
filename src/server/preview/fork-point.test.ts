// fork-point.ts — the commit-list-walk merge base used for private repos
// (never a true GitHub fork, so a cross-repo compare 404s). Fake GhClient
// objects that record every path they were asked for; no network.

import { test, expect, beforeEach } from "bun:test";
import {
  canonicalMainShas,
  findForkPoint,
  forkPointCounts,
  resolveForkPoint,
  __resetForkPointCacheForTest,
} from "./fork-point.ts";

beforeEach(() => {
  __resetForkPointCacheForTest();
});

function fakeGh(byPath: Record<string, any>): any {
  const calls: string[] = [];
  return {
    calls,
    async fetchJson(p: string) {
      calls.push(p);
      const r = byPath[p];
      if (!r) return { ok: false, status: 404, json: null };
      return r;
    },
  };
}

// A full page (100 shas) so pagination continues; the fixtures below only
// care about a handful of them.
function fullPage(prefix: string): { sha: string }[] {
  return Array.from({ length: 100 }, (_, i) => ({ sha: `${prefix}${i}` }));
}

test("findForkPoint: hit on page 1", async () => {
  const gh = fakeGh({
    "/repos/acme/priv/commits?sha=tip&per_page=100&page=1": { ok: true, status: 200, json: [{ sha: "tip" }, { sha: "shared1" }] },
  });
  const canonical = new Set(["shared1", "other"]);
  expect(await findForkPoint(gh, "acme/priv", "tip", canonical)).toBe("shared1");
  expect(gh.calls.length).toBe(1);
});

test("findForkPoint: hit on page 2", async () => {
  const gh = fakeGh({
    "/repos/acme/priv/commits?sha=tip&per_page=100&page=1": { ok: true, status: 200, json: fullPage("p1-") },
    "/repos/acme/priv/commits?sha=tip&per_page=100&page=2": { ok: true, status: 200, json: [{ sha: "shared1" }] },
  });
  const canonical = new Set(["shared1"]);
  expect(await findForkPoint(gh, "acme/priv", "tip", canonical)).toBe("shared1");
  expect(gh.calls.length).toBe(2);
});

test("findForkPoint: no hit within the cap returns null, exactly maxPages fetched", async () => {
  const byPath: Record<string, any> = {};
  for (let p = 1; p <= 3; p++) byPath[`/repos/acme/priv/commits?sha=tip&per_page=100&page=${p}`] = { ok: true, status: 200, json: fullPage(`p${p}-`) };
  const gh = fakeGh(byPath);
  expect(await findForkPoint(gh, "acme/priv", "tip", new Set(["nowhere"]), 3)).toBeNull();
  expect(gh.calls.length).toBe(3);
});

test("findForkPoint: a non-ok page returns null immediately", async () => {
  const gh = fakeGh({
    "/repos/acme/priv/commits?sha=tip&per_page=100&page=1": { ok: false, status: 500, json: null },
  });
  expect(await findForkPoint(gh, "acme/priv", "tip", new Set(["x"]))).toBeNull();
  expect(gh.calls.length).toBe(1);
});

test("canonicalMainShas: cache reused across two calls with the same atlasCommit", async () => {
  const gh = fakeGh({
    "/repos/sky-ecosystem/next-gen-atlas/commits?sha=abc123&per_page=100&page=1": { ok: true, status: 200, json: [{ sha: "a" }, { sha: "b" }] },
  });
  const first = await canonicalMainShas(gh, "abc123");
  const second = await canonicalMainShas(gh, "abc123");
  expect(second).toBe(first);
  expect([...first].sort()).toEqual(["a", "b"]);
  expect(gh.calls.length).toBe(1); // second call served entirely from cache
});

test("canonicalMainShas: refetched for a different atlasCommit", async () => {
  const gh = fakeGh({
    "/repos/sky-ecosystem/next-gen-atlas/commits?sha=abc123&per_page=100&page=1": { ok: true, status: 200, json: [{ sha: "a" }] },
    "/repos/sky-ecosystem/next-gen-atlas/commits?sha=def456&per_page=100&page=1": { ok: true, status: 200, json: [{ sha: "z" }] },
  });
  await canonicalMainShas(gh, "abc123");
  const forOther = await canonicalMainShas(gh, "def456");
  expect([...forOther]).toEqual(["z"]);
  expect(gh.calls.length).toBe(2);
});

test("__resetForkPointCacheForTest clears the cache", async () => {
  const gh = fakeGh({
    "/repos/sky-ecosystem/next-gen-atlas/commits?sha=abc123&per_page=100&page=1": { ok: true, status: 200, json: [{ sha: "a" }] },
  });
  await canonicalMainShas(gh, "abc123");
  __resetForkPointCacheForTest();
  await canonicalMainShas(gh, "abc123");
  expect(gh.calls.length).toBe(2); // no cache hit after reset
});

test("forkPointCounts: one failing compare leaves only that count undefined", async () => {
  const repoGh = fakeGh({
    "/repos/acme/priv/compare/fp...tip": { ok: true, status: 200, json: { ahead_by: 3 } },
  });
  const canonicalGh = fakeGh({}); // 404 -> caught, undefined
  const counts = await forkPointCounts(repoGh, canonicalGh, "acme/priv", "fp", "tip", "abc123");
  expect(counts.aheadBy).toBe(3);
  expect(counts.behindBy).toBeUndefined();
});

test("resolveForkPoint end-to-end", async () => {
  const repoGh = fakeGh({
    "/repos/acme/priv/commits?sha=tip&per_page=100&page=1": { ok: true, status: 200, json: [{ sha: "tip" }, { sha: "shared1" }] },
    "/repos/acme/priv/compare/shared1...tip": { ok: true, status: 200, json: { ahead_by: 2 } },
  });
  const canonicalGh = fakeGh({
    "/repos/sky-ecosystem/next-gen-atlas/commits?sha=abc123&per_page=100&page=1": { ok: true, status: 200, json: [{ sha: "shared1" }, { sha: "other" }] },
    "/repos/sky-ecosystem/next-gen-atlas/compare/shared1...abc123": { ok: true, status: 200, json: { ahead_by: 5 } },
  });

  const result = await resolveForkPoint({ repoGh, canonicalGh, repo: "acme/priv", tip: "tip", atlasCommit: "abc123" });
  expect(result).toEqual({ mergeBase: "shared1", aheadBy: 2, behindBy: 5 });
});

test("canonicalMainShas: a page-capped walk IS cached (immutable for this atlasCommit)", async () => {
  const byPath: Record<string, any> = {};
  for (let p = 1; p <= 10; p++) byPath[`/repos/sky-ecosystem/next-gen-atlas/commits?sha=abc123&per_page=100&page=${p}`] = { ok: true, status: 200, json: fullPage(`p${p}-`) };
  const gh = fakeGh(byPath);
  await canonicalMainShas(gh, "abc123");
  expect(gh.calls.length).toBe(10);
  await canonicalMainShas(gh, "abc123");
  expect(gh.calls.length).toBe(10); // cache hit — no refetch
});

test("canonicalMainShas: a non-ok page mid-walk is not cached — retried next call", async () => {
  const gh = fakeGh({
    "/repos/sky-ecosystem/next-gen-atlas/commits?sha=abc123&per_page=100&page=1": { ok: true, status: 200, json: fullPage("p1-") },
    "/repos/sky-ecosystem/next-gen-atlas/commits?sha=abc123&per_page=100&page=2": { ok: false, status: 500, json: null },
  });
  const first = await canonicalMainShas(gh, "abc123");
  expect(first.size).toBe(100); // partial set still returned (best-effort)
  expect(gh.calls.length).toBe(2);
  await canonicalMainShas(gh, "abc123");
  expect(gh.calls.length).toBe(4); // uncached — page 1 refetched too
});

test("resolveForkPoint: null when no fork point turns up", async () => {
  const repoGh = fakeGh({
    "/repos/acme/priv/commits?sha=tip&per_page=100&page=1": { ok: true, status: 200, json: [{ sha: "tip" }] },
  });
  const canonicalGh = fakeGh({
    "/repos/sky-ecosystem/next-gen-atlas/commits?sha=abc123&per_page=100&page=1": { ok: true, status: 200, json: [{ sha: "other" }] },
  });
  expect(await resolveForkPoint({ repoGh, canonicalGh, repo: "acme/priv", tip: "tip", atlasCommit: "abc123" })).toBeNull();
});
