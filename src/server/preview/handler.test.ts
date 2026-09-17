// Handler dispatch + diff + artifact serving. Needs built main artifacts
// (public/docs.json etc.) so diff has an in-memory baseline; skips otherwise.
// Run via `bun test`. PREVIEW_DIR is set before a dynamic import so cache picks it up.
//
// Private-preview gating (Phase 3): mocks ./access.ts's authorizePreviewAccess
// (per-test decision, queryable via accessCalls) and ../db.ts's sql tag (same
// mock shape as db.test.ts / access.test.ts) so the sha-id resolution path in
// resolveId's "sha" branch (which reads the previews table via getPreviewRow)
// doesn't need a real Postgres connection. Both mocks are restored in afterAll
// so they don't leak into sibling test files in a full-directory `bun test
// src/server` run.

import { test, expect, mock, afterAll, beforeEach } from "bun:test";
import { toUuidArrayLiteral, fromUuidArray } from "../pg-array.ts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "../config.ts";
import type { PreviewMeta } from "./cache.ts";

type AccessDecision = "ok" | "login-required" | "forbidden" | "unavailable";
let accessDecision: AccessDecision = "ok";
let accessCalls: { repo: string }[] = [];
mock.module("./access.ts", () => ({
  authorizePreviewAccess: (_req: Request, repo: string) => {
    accessCalls.push({ repo });
    return Promise.resolve(accessDecision);
  },
  // Keep the factory COMPLETE: mock.module persists process-globally, so if this
  // wins at access.test.ts's `await import("./access.ts")` (file-order dependent),
  // a missing export would leave __resetAccessCacheForTest undefined and crash
  // that suite's beforeEach. A no-op is safe — the real cache isn't loaded here.
  __resetAccessCacheForTest: () => {},
}));

// A queued Error rejects instead of resolving — lets a test drive a query's
// failure branch (e.g. /api/preview/list's catch → []) without every OTHER
// test in this file needing to think about it (a plain array is still the
// common case and behaves exactly as before).
let dbQueued: unknown[] = [];
mock.module("../db.ts", () => ({
  sql(_strings: TemplateStringsArray, ..._values: unknown[]) {
    const next = dbQueued.shift();
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next ?? []);
  },
  dbTarget: () => "mock-db",
  waitForDb: () => Promise.resolve(),
  toVectorLiteral: (vec: number[]) => `[${vec.join(",")}]`,
  // Real impls, never re-stubbed: `Array.isArray("{uuid,uuid}")` is false, so a
  // hand-rolled stub silently returns [] for what Bun.sql actually hands back.
  // See pg-array.ts; enforced by scripts/aux/audit-mock-modules.mjs.
  toUuidArrayLiteral,
  fromUuidArray,
}));

afterAll(() => mock.restore());

beforeEach(() => {
  accessDecision = "ok";
  accessCalls = [];
  dbQueued = [];
});

const SHA = "a".repeat(40);
const stubServer = { requestIP: () => ({ address: "1.2.3.4" }) } as any;
const TEST_REPO = "octocat/private-atlas";

// PREVIEW_DIR is process-global and cache.ts freezes it at import time, so it
// must be put back: config.test.ts's ENV_KEYS snapshot doesn't cover it, and a
// leaked value would redirect every later file's preview paths at our scratch dir.
// One scratch root for the whole file (cache.ts only ever reads the value it saw
// at import time, so a per-test dir would be ignored anyway).
const origPreviewDir = process.env.PREVIEW_DIR;
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "pv-h-"));
process.env.PREVIEW_DIR = scratchDir;
afterAll(() => {
  if (origPreviewDir === undefined) delete process.env.PREVIEW_DIR;
  else process.env.PREVIEW_DIR = origPreviewDir;
  fs.rmSync(scratchDir, { recursive: true, force: true });
});

// Whether main artifacts are built decides the whole file (diff needs an
// in-memory baseline). Resolved once here so the tests can declare an explicit
// `skipIf` — an early `return` inside the test body reports green while
// asserting nothing.
const { loadIndexes, setIndexes, getIndexes } = await import("../retrieval/indexes.ts");
setIndexes(loadIndexes());
const NO_ARTIFACTS = getIndexes().docMap.size === 0;

async function setup() {
  const ix = getIndexes();
  const { handlePreview } = await import("./handler.ts");
  const { previewPaths, writeMeta } = await import("./cache.ts");

  // Fake bundle: one changed main doc + one brand-new doc.
  const someId = [...ix.docMap.keys()][0];
  const orig = ix.docMap.get(someId)!;
  const newId = "11111111-2222-3333-4444-555555555555";
  const p = previewPaths(SHA);
  fs.mkdirSync(p.outDir, { recursive: true });
  fs.writeFileSync(
    path.join(p.outDir, "docs.json"),
    JSON.stringify({
      atlasCommit: SHA,
      nodes: {
        [someId]: { ...orig, content: (orig.content || "") + " EDITED" },
        [newId]: { id: newId, doc_no: "A.9", title: "New", type: "Core", depth: 2, parentId: null, order: 9, content: "new", contentHash: "x" },
      },
    }),
  );
  writeMeta(SHA, { sha: SHA, repo: "r", ref: "pull-1", kind: "pr", resolvedAt: "t", docCount: 2, buildMs: 1 });

  // handlePreview returns Response | Promise<Response> (meta/artifact are async);
  // normalize to a Promise so every call site can await.
  const call = (pathname: string) => Promise.resolve(handlePreview(new Request("http://x" + pathname), stubServer, pathname));
  return { call, someId, newId };
}

test.skipIf(NO_ARTIFACTS)("handler: artifact + meta served, diff vs main, allowlist + sha validation", async () => {
  const { call, someId, newId } = await setup();

  expect((await call(`/api/preview/${SHA}/docs.json`)).status).toBe(200);
  expect(((await (await call(`/api/preview/${SHA}/meta.json`)).json()) as any).docCount).toBe(2);

  const diff = (await (await call(`/api/preview/${SHA}/diff.json`)).json()) as any;
  expect(diff.added).toContain(newId);
  expect(diff.changed).toContain(someId);

  // on-chain artifact reused from main → not allowlisted
  expect((await call(`/api/preview/${SHA}/addresses.json`)).status).toBe(404);
  // non-40-hex sha rejected
  expect((await call(`/api/preview/zzz/docs.json`)).status).toBe(404);
  // unknown bundle → 404
  expect((await call(`/api/preview/${"b".repeat(40)}/docs.json`)).status).toBe(404);
});

test.skipIf(NO_ARTIFACTS)("handler: malformed percent-encoding on the events id returns 404, not a 500", async () => {
  const { call } = await setup();
  // A lone "%" or an incomplete escape throws inside decodeURIComponent.
  const res = await call("/api/preview/%E0%A4%A/events");
  expect(res.status).toBe(404);
});

test.skipIf(NO_ARTIFACTS)("handler: diffCache evicts FIFO once it exceeds DIFF_CACHE_MAX", async () => {
  const { call } = await setup();
  const { diffCache, DIFF_CACHE_MAX } = await import("./handler.ts");
  const { previewPaths, writeMeta } = await import("./cache.ts");

  diffCache.clear();
  const n = DIFF_CACHE_MAX + 50;
  for (let i = 0; i < n; i++) {
    const sha = i.toString(16).padStart(40, "0");
    const p = previewPaths(sha);
    fs.mkdirSync(p.outDir, { recursive: true });
    fs.writeFileSync(path.join(p.outDir, "docs.json"), JSON.stringify({ atlasCommit: sha, nodes: {} }));
    writeMeta(sha, { sha, repo: "r", ref: "b", kind: "branch", resolvedAt: "t", docCount: 0, buildMs: 1 });
    await call(`/api/preview/${sha}/diff.json`);
  }
  expect(diffCache.size).toBeLessThanOrEqual(DIFF_CACHE_MAX);
}, 30_000);

// ---------------------------------------------------------------------------
// Phase 3: private-preview HTTP enforcement. These don't need built main
// artifacts (docs.json's diff branch is never reached — every bundle below
// ships its own diff.json), so they run for real even in an environment where
// the setup() tests above skip.
// ---------------------------------------------------------------------------

async function freshHandler() {
  // Only takes effect on the FIRST import of bundle-store.ts in this process
  // (PREVIEW_DIR is a module-level const there) — matches setup()'s own
  // unconditional assignment above; harmless to repeat.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pv-h2-"));
  process.env.PREVIEW_DIR = dir;
  const { handlePreview } = await import("./handler.ts");
  const { previewPaths, writeMeta, readMeta } = await import("./cache.ts");
  const call = (pathname: string) => Promise.resolve(handlePreview(new Request("http://x" + pathname), stubServer, pathname));
  return { call, handlePreview, previewPaths, writeMeta, readMeta };
}

function makeReadyBundle(
  previewPaths: (sha: string) => { outDir: string },
  writeMeta: (sha: string, meta: PreviewMeta, root?: string) => void,
  sha: string,
  opts: { private?: boolean; repo?: string; extra?: Partial<PreviewMeta> } = {},
): void {
  const p = previewPaths(sha);
  fs.mkdirSync(p.outDir, { recursive: true });
  fs.writeFileSync(path.join(p.outDir, "docs.json"), JSON.stringify({ atlasCommit: sha, nodes: {} }));
  // diff.json present so diffResponse serves it directly, without needing
  // main's in-memory docMap (these privacy tests don't build one up front).
  fs.writeFileSync(path.join(p.outDir, "diff.json"), JSON.stringify({ added: [], changed: [] }));
  writeMeta(sha, {
    sha,
    repo: opts.repo ?? TEST_REPO,
    ref: "main",
    kind: "branch",
    resolvedAt: "t",
    docCount: 0,
    buildMs: 1,
    private: opts.private,
    ...opts.extra,
  });
}

async function readSSE(res: Response): Promise<any[]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
  }
  return buf
    .split("\n\n")
    .map((chunk) => chunk.match(/^data: (.+)$/m)?.[1])
    .filter((s): s is string => !!s)
    .map((s) => JSON.parse(s));
}

const SHA_PUBLIC = "1".repeat(40);
const SHA_LOGIN = "2".repeat(40);
const SHA_FORBIDDEN = "3".repeat(40);
const SHA_UNAVAILABLE = "4".repeat(40);
const SHA_AUTHORIZED = "5".repeat(40);
const SHA_G1 = "6".repeat(40);
const SHA_EVENTS = "7".repeat(40);

test("private preview handler: public bundle unaffected — served with CORS, no private headers, no auth call", async () => {
  const { call, previewPaths, writeMeta } = await freshHandler();
  makeReadyBundle(previewPaths, writeMeta, SHA_PUBLIC, { private: false });
  const res = await call(`/api/preview/${SHA_PUBLIC}/docs.json`);
  expect(res.status).toBe(200);
  expect(res.headers.get("access-control-allow-origin")).toBe("*");
  expect(res.headers.get("cache-control")).toBeNull();
  expect(accessCalls.length).toBe(0); // public path never consults authorizePreviewAccess
});

test("private preview handler: unauthorized visitors are denied on docs.json, diff.json, and meta.json (401/403/503)", async () => {
  const { call, previewPaths, writeMeta } = await freshHandler();
  const cases: [string, AccessDecision, number][] = [
    [SHA_LOGIN, "login-required", 401],
    [SHA_FORBIDDEN, "forbidden", 403],
    [SHA_UNAVAILABLE, "unavailable", 503],
  ];
  for (const [sha, decision, status] of cases) {
    makeReadyBundle(previewPaths, writeMeta, sha, { private: true });
    accessDecision = decision;
    for (const suffix of ["docs.json", "diff.json", "meta.json"]) {
      const res = await call(`/api/preview/${sha}/${suffix}`);
      expect(res.status).toBe(status);
      expect(res.status).not.toBe(200);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    }
  }
});

test("private preview handler: authorized visitor gets docs.json 200 with PRIVATE_HEADERS", async () => {
  const { call, previewPaths, writeMeta } = await freshHandler();
  makeReadyBundle(previewPaths, writeMeta, SHA_AUTHORIZED, { private: true });
  accessDecision = "ok";
  const res = await call(`/api/preview/${SHA_AUTHORIZED}/docs.json`);
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("private, no-store");
  expect(res.headers.get("x-robots-tag")).toBe("noindex");
  expect(res.headers.get("access-control-allow-origin")).toBeNull();
});

test("private preview handler: G1 mid-build bundle (meta.json not yet written) 404s — even for a private repo, even with no session", async () => {
  const { call, previewPaths } = await freshHandler();
  const p = previewPaths(SHA_G1);
  fs.mkdirSync(p.outDir, { recursive: true });
  fs.writeFileSync(path.join(p.outDir, "docs.json"), JSON.stringify({ atlasCommit: SHA_G1, nodes: {} }));
  // meta.json deliberately absent → bundleReady() is false regardless of privacy;
  // "no meta yet" must read as not-serveable, never as public (G1).
  accessDecision = "login-required"; // worst case: no session at all
  const res = await call(`/api/preview/${SHA_G1}/docs.json`);
  expect(res.status).toBe(404);
  expect(accessCalls.length).toBe(0); // gateSha never reached privacy/DB — bundleReady gates first
});

test("/events: a private repo resolve that authorizePreviewAccess forbids fails closed and never starts a build (G3)", async () => {
  const { handlePreview } = await freshHandler();
  const { inflightShas } = await import("./build.ts");
  // Seed the previews-table row resolveId's "sha" branch reads via getPreviewRow.
  dbQueued = [
    [
      {
        sha: SHA_EVENTS,
        repo: TEST_REPO,
        ref: "main",
        kind: "branch",
        pr_number: null,
        pr_title: null,
        pr_author: null,
        pr_state: null,
        doc_count: 0,
        build_ms: 0,
        blocked_at: null,
        trust_tier: null,
        private: true,
      },
    ],
  ];
  accessDecision = "forbidden";
  const pathname = `/api/preview/${SHA_EVENTS}/events`;
  const res = handlePreview(new Request("http://x" + pathname), stubServer, pathname) as Response;
  const events = await readSSE(res);
  expect(events).toContainEqual({ phase: "failed", code: "forbidden" });
  // No sha-bearing "ready"/"fetching" event was ever sent, and no build started.
  expect(events.some((e) => e.phase === "ready" || e.phase === "fetching")).toBe(false);
  expect(inflightShas().has(SHA_EVENTS)).toBe(false);
});

test("/events: deferred private-branch id — a forbidden caller is denied and the branch→sha lookup NEVER fires (G7)", async () => {
  const { handlePreview } = await freshHandler();
  const { inflightShas } = await import("./build.ts");
  const { __resetCachesForTest } = await import("./github-app.ts");
  __resetCachesForTest();

  // Turn the feature on and give the App-JWT signer real credentials.
  const orig = {
    enabled: config.privatePreviewsEnabled,
    appId: config.githubAppId,
    key: config.githubAppPrivateKey,
    fetch: globalThis.fetch,
  };
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  config.privatePreviewsEnabled = true;
  config.githubAppId = "123";
  config.githubAppPrivateKey = privateKey.export({ type: "pkcs8", format: "pem" }) as string;

  // Stub GitHub: the service token 404s on the repo (it's private) but the App
  // JWT sees an installation → resolvePrivacy = "private". A branch fetch or a
  // token mint here would be a BUG (the lookup must stay deferred past auth) —
  // flag both.
  let branchFetched = false;
  let tokenMinted = false;
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    if (u.endsWith("/installation")) return Response.json({ id: 77 });
    if (u.endsWith("/access_tokens")) {
      tokenMinted = true;
      return Response.json({ token: "inst-tok" });
    }
    if (u.includes("/branches/")) {
      branchFetched = true;
      return Response.json({ commit: { sha: "e".repeat(40) } });
    }
    if (/\/repos\/[^/]+\/[^/]+$/.test(u)) return new Response("no", { status: 404 });
    return new Response("no", { status: 404 });
  }) as unknown as typeof fetch;

  try {
    accessDecision = "forbidden";
    const id = encodeURIComponent("octocat:secret-atlas:hush");
    const pathname = `/api/preview/${id}/events`;
    const res = handlePreview(new Request("http://x" + pathname), stubServer, pathname) as Response;
    const events = await readSSE(res);

    expect(events).toContainEqual({ phase: "failed", code: "forbidden" });
    // The G7 guarantee: resolution deferred the branch→sha lookup, and the
    // forbidden decision short-circuits before the lookup, the token mint, and
    // any build ever run.
    expect(branchFetched).toBe(false);
    expect(tokenMinted).toBe(false);
    expect(accessCalls.some((c) => c.repo === "octocat/secret-atlas")).toBe(true);
    expect(events.some((e) => e.phase === "ready" || e.phase === "fetching")).toBe(false);
    expect(inflightShas().size).toBe(0);
  } finally {
    globalThis.fetch = orig.fetch;
    config.privatePreviewsEnabled = orig.enabled;
    config.githubAppId = orig.appId;
    config.githubAppPrivateKey = orig.key;
    accessDecision = "ok";
  }
});

// ---------------------------------------------------------------------------
// rateLimited / ipHits — the per-IP fixed window on the events endpoint.

test("/events: deferred private-PR id — a forbidden caller never fetches pulls or git/ref (G7)", async () => {
  const { handlePreview } = await freshHandler();
  const { inflightShas } = await import("./build.ts");
  const { __resetCachesForTest } = await import("./github-app.ts");
  __resetCachesForTest();

  const orig = {
    enabled: config.privatePreviewsEnabled,
    appId: config.githubAppId,
    key: config.githubAppPrivateKey,
    fetch: globalThis.fetch,
  };
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  config.privatePreviewsEnabled = true;
  config.githubAppId = "123";
  config.githubAppPrivateKey = privateKey.export({ type: "pkcs8", format: "pem" }) as string;

  let pullFetched = false;
  let refFetched = false;
  let tokenMinted = false;
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    if (u.endsWith("/installation")) return Response.json({ id: 77 });
    if (u.endsWith("/access_tokens")) {
      tokenMinted = true;
      return Response.json({ token: "inst-tok" });
    }
    if (u.includes("/pulls/")) {
      pullFetched = true;
      return Response.json({ head: { sha: "e".repeat(40), ref: "feat" } });
    }
    if (u.includes("/git/ref/")) {
      refFetched = true;
      return Response.json({ object: { sha: "e".repeat(40) } });
    }
    if (/\/repos\/[^/]+\/[^/]+$/.test(u)) return new Response("no", { status: 404 });
    return new Response("no", { status: 404 });
  }) as unknown as typeof fetch;

  try {
    accessDecision = "forbidden";
    const id = encodeURIComponent("octocat:secret-atlas:pull-42");
    const pathname = `/api/preview/${id}/events`;
    const res = handlePreview(new Request("http://x" + pathname), stubServer, pathname) as Response;
    const events = await readSSE(res);

    expect(events).toContainEqual({ phase: "failed", code: "forbidden" });
    expect(pullFetched).toBe(false);
    expect(refFetched).toBe(false);
    expect(tokenMinted).toBe(false);
    expect(accessCalls.some((c) => c.repo === "octocat/secret-atlas")).toBe(true);
    expect(events.some((e) => e.phase === "ready" || e.phase === "fetching")).toBe(false);
    expect(inflightShas().size).toBe(0);
  } finally {
    globalThis.fetch = orig.fetch;
    config.privatePreviewsEnabled = orig.enabled;
    config.githubAppId = orig.appId;
    config.githubAppPrivateKey = orig.key;
    accessDecision = "ok";
  }
});

// ---------------------------------------------------------------------------
// rateLimited / ipHits — the per-IP fixed window on the events endpoint.
// Direct (no HTTP): driving the real threshold via ~30+ full SSE round-trips
// per case would work but is slow and indirect; the exported map/function let
// this pin the actual guard (a real bug — an off-by-one on `> IP_LIMIT` vs
// `>= IP_LIMIT`, or a sweep that also evicts live entries — would break it).
// ---------------------------------------------------------------------------

test("rateLimited: exactly IP_LIMIT calls pass, the next is limited, and a different IP has its own independent counter", async () => {
  const { rateLimited, ipHits, IP_LIMIT } = await import("./handler.ts");
  ipHits.clear();
  try {
    const ip = "203.0.113.9";
    for (let i = 0; i < IP_LIMIT; i++) expect(rateLimited(ip)).toBe(false);
    expect(rateLimited(ip)).toBe(true);
    expect(rateLimited("203.0.113.10")).toBe(false); // unaffected by ip's count
  } finally {
    ipHits.clear();
  }
});

test("rateLimited: once the map grows past 5000, a new IP's call sweeps expired entries but leaves live ones alone", async () => {
  const { rateLimited, ipHits } = await import("./handler.ts");
  ipHits.clear();
  try {
    const now = Date.now();
    for (let i = 0; i < 5000; i++) ipHits.set(`expired-${i}`, { n: 1, reset: now - 1 });
    ipHits.set("still-live", { n: 1, reset: now + 60_000 });
    expect(ipHits.size).toBe(5001);

    rateLimited("trigger-sweep"); // size > 5000 → sweep runs before this ip is added
    expect(ipHits.has("still-live")).toBe(true);
    expect(ipHits.has("trigger-sweep")).toBe(true);
    expect(ipHits.size).toBe(2); // every expired-* entry pruned
  } finally {
    ipHits.clear();
  }
});

// ---------------------------------------------------------------------------
// resolveCache — the id→Resolved TTL cache. Same FIFO-cap shape as diffCache
// (tested above); exported for the same reason (see the eviction comment on
// diffCache's declaration).
// ---------------------------------------------------------------------------

test("resolveCache evicts FIFO once it exceeds RESOLVE_CACHE_MAX, so scanner traffic can't grow it unbounded", async () => {
  const { call } = await freshHandler();
  const { resolveCache, RESOLVE_CACHE_MAX } = await import("./handler.ts");
  resolveCache.clear();
  try {
    for (let i = 0; i < RESOLVE_CACHE_MAX; i++) resolveCache.set(`seed-${i}`, { at: Date.now(), v: { error: "not-found" } });
    expect(resolveCache.size).toBe(RESOLVE_CACHE_MAX);

    // A fresh, distinct id that resolves via the cheap local "unparseable" path
    // (no network/DB — see the "unparseable id" test below) still goes through
    // the same set-then-evict bookkeeping as any other successful resolution.
    await readSSE(await call("/api/preview/ev1:ev2:ev3:ev4/events"));

    expect(resolveCache.size).toBe(RESOLVE_CACHE_MAX); // grew to MAX+1, then evicted back down
    expect(resolveCache.has("seed-0")).toBe(false); // oldest inserted → first evicted
    expect(resolveCache.has("ev1:ev2:ev3:ev4")).toBe(true); // the newest survives
  } finally {
    resolveCache.clear();
  }
});

// ---------------------------------------------------------------------------
// resolveId's unparseable-id branch + failInstallMessage. decodeId returns
// null for more than just "" — e.g. a branch grammar id with an empty owner or
// a stray extra ":" (preview.test.ts already proves decodeId("a:b:c:d") is
// null; this drives that same shape through the real HTTP path instead of
// calling decodeId directly). Neither existing test ever makes resolveId
// return an `{error}` shape at all, so failInstallMessage was never called.
// ---------------------------------------------------------------------------

test("/events: a rate-limited IP is told to try again shortly, before resolution is even attempted", async () => {
  const { handlePreview } = await freshHandler();
  const { ipHits, IP_LIMIT } = await import("./handler.ts");
  const limitedIp = "203.0.113.55"; // distinct from stubServer's fixed IP — isolates this from every other test's count
  const limitedServer = { requestIP: () => ({ address: limitedIp }) } as any;
  ipHits.set(limitedIp, { n: IP_LIMIT + 1, reset: Date.now() + 60_000 });
  try {
    const pathname = "/api/preview/whatever-branch-name/events";
    const res = handlePreview(new Request("http://x" + pathname), limitedServer, pathname) as Response;
    const events = await readSSE(res);
    // Exactly one event — not even "resolving" precedes it, proving the rate
    // limit is checked before resolveId ever runs (no wasted GitHub/DB call).
    expect(events).toEqual([{ phase: "failed", code: "rate-limited", message: "Too many preview requests — try again shortly." }]);
  } finally {
    ipHits.delete(limitedIp);
  }
});

test("/events: deferred private-branch id where the branch lookup itself fails (branch deleted) reports not-found, not app-not-installed", async () => {
  const { handlePreview } = await freshHandler();
  const { __resetCachesForTest } = await import("./github-app.ts");
  __resetCachesForTest();

  const orig = {
    enabled: config.privatePreviewsEnabled,
    appId: config.githubAppId,
    key: config.githubAppPrivateKey,
    fetch: globalThis.fetch,
  };
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  config.privatePreviewsEnabled = true;
  config.githubAppId = "123";
  config.githubAppPrivateKey = privateKey.export({ type: "pkcs8", format: "pem" }) as string;

  // Installation resolves fine (repo IS private, App IS installed — reaching
  // resolvePrivateBranch at all) but the branch itself 404s once looked up —
  // e.g. deleted between the initial resolve and this authorized retry.
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    if (u.endsWith("/installation")) return Response.json({ id: 77 });
    if (u.endsWith("/access_tokens")) return Response.json({ token: "inst-tok" });
    if (u.includes("/branches/")) return new Response("not found", { status: 404 });
    if (/\/repos\/[^/]+\/[^/]+$/.test(u)) return new Response("no", { status: 404 });
    return new Response("no", { status: 404 });
  }) as unknown as typeof fetch;

  try {
    accessDecision = "ok";
    const id = encodeURIComponent("octocat:secret-atlas:ghost-branch");
    const pathname = `/api/preview/${id}/events`;
    const res = handlePreview(new Request("http://x" + pathname), stubServer, pathname) as Response;
    const events = await readSSE(res);
    expect(events).toContainEqual({ phase: "failed", code: "not-found" }); // resolvePrivateBranch's own not-found — no install-url message
    expect(events.some((e) => e.phase === "ready" || e.phase === "fetching")).toBe(false);
  } finally {
    globalThis.fetch = orig.fetch;
    config.privatePreviewsEnabled = orig.enabled;
    config.githubAppId = orig.appId;
    config.githubAppPrivateKey = orig.key;
    accessDecision = "ok";
  }
});

test("/events: an unparseable id (decodeId → null) resolves as not-found with no install message", async () => {
  const { call } = await freshHandler();
  const res = await call("/api/preview/a:b:c:d/events");
  const events = await readSSE(res);
  expect(events).toContainEqual({ phase: "failed", code: "not-found" }); // no `message` key at all
});

test("/events: an app-not-installed resolve failure carries the App's install URL as the message", async () => {
  const { handlePreview } = await freshHandler();
  const { __resetCachesForTest } = await import("./github-app.ts");
  __resetCachesForTest();

  const orig = {
    enabled: config.privatePreviewsEnabled,
    appId: config.githubAppId,
    key: config.githubAppPrivateKey,
    fetch: globalThis.fetch,
  };
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  config.privatePreviewsEnabled = true;
  config.githubAppId = "123";
  config.githubAppPrivateKey = privateKey.export({ type: "pkcs8", format: "pem" }) as string;

  // Service token can't see the repo (private-looking 404) AND the App isn't
  // installed on it either (installation lookup also 404) → resolvePrivacy
  // returns "app-not-installed", which resolveRef surfaces directly (no
  // PendingPrivate — there's no installation to defer a lookup through).
  // The owner's public account id resolves, so the install link targets that
  // account (never the installer's whole org list).
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    if (u.endsWith("/app")) return Response.json({ slug: "redlens-preview" });
    if (u.endsWith("/users/noinstall")) return Response.json({ id: 777, login: "noinstall" });
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;

  try {
    const id = encodeURIComponent("noinstall:nobranch");
    const pathname = `/api/preview/${id}/events`;
    const res = handlePreview(new Request("http://x" + pathname), stubServer, pathname) as Response;
    const events = await readSSE(res);
    expect(events).toContainEqual({
      phase: "failed",
      code: "app-not-installed",
      message: "https://github.com/apps/redlens-preview/installations/new/permissions?suggested_target_id=777&target_id=777&repository_ids[]=0",
    });
  } finally {
    globalThis.fetch = orig.fetch;
    config.privatePreviewsEnabled = orig.enabled;
    config.githubAppId = orig.appId;
    config.githubAppPrivateKey = orig.key;
  }
});

// ---------------------------------------------------------------------------
// SSE stream cancel wiring — makeUnsubGate's own cancel/resolve races are
// already covered directly in unsub-gate.test.ts; this proves the REAL
// ReadableStream actually invokes it (`cancel() { gate.cancel(); }`), which
// only a live stream, not makeUnsubGate in isolation, can exercise.
// ---------------------------------------------------------------------------

test("SSE stream: cancelling the response body runs the stream's cancel callback without throwing", async () => {
  const { call } = await freshHandler();
  // Reuses the cheap unparseable-id path above (no network/DB) — resolveId
  // settles almost immediately either way, and what's under test here is the
  // cancel plumbing, not resolution itself.
  const pathname = "/api/preview/a:b:c:d/events";
  const res = await call(pathname);
  await expect(res.body!.cancel()).resolves.toBeUndefined();
});

// ---------------------------------------------------------------------------
// drive()'s happy tail — the biggest previously-untested block in this file.
// Every existing /events test (G3, G7, malformed-id) returns before ever
// reaching a resolved sha. These three cover: an admin-blocked sha (closes
// without serving or building), an authorized already-ready bundle (serves
// "ready" immediately, touching LRU + the DB), and an authorized deferred-
// private branch with NO ready bundle (completes the branch→sha lookup for
// real and starts a REAL background build via the real getOrStartBuild — the
// tarball fetch is stubbed to 404 so it fails fast, offline, instead of
// hitting the network, and its promise is awaited to completion via readSSE
// so nothing is left running in the background for a later test to trip over).
// ---------------------------------------------------------------------------

test("/events: an admin-blocked sha neither serves nor rebuilds, even resolved fresh via the previews table", async () => {
  const { handlePreview } = await freshHandler();
  const { inflightShas } = await import("./build.ts");
  const SHA_BLOCKED = "8".repeat(40);
  dbQueued = [
    [
      {
        sha: SHA_BLOCKED,
        repo: "someone/next-gen-atlas",
        ref: "main",
        kind: "branch",
        pr_number: null,
        pr_title: null,
        pr_author: null,
        pr_state: null,
        doc_count: 0,
        build_ms: 0,
        blocked_at: "2026-01-01T00:00:00Z",
        trust_tier: null,
        private: false,
      },
    ], // resolveId's "sha" branch: getPreviewRow
    [{ x: 1 }], // isBlockedSha → true
  ];
  const pathname = `/api/preview/${SHA_BLOCKED}/events`;
  const res = handlePreview(new Request("http://x" + pathname), stubServer, pathname) as Response;
  const events = await readSSE(res);
  expect(events).toContainEqual({ phase: "failed", code: "not-found" });
  expect(events.some((e) => e.phase === "ready" || e.phase === "fetching")).toBe(false);
  expect(inflightShas().size).toBe(0); // never even reached getOrStartBuild
});

test("/events: an authorized private sha resolution with an already-ready bundle sends ready immediately (touches LRU + DB)", async () => {
  const { handlePreview, previewPaths, writeMeta } = await freshHandler();
  const SHA_READY = "9".repeat(40);
  const p = previewPaths(SHA_READY);
  fs.mkdirSync(p.outDir, { recursive: true });
  fs.writeFileSync(path.join(p.outDir, "docs.json"), JSON.stringify({ atlasCommit: SHA_READY, nodes: {} }));
  writeMeta(SHA_READY, { sha: SHA_READY, repo: TEST_REPO, ref: "main", kind: "branch", resolvedAt: "t", docCount: 0, buildMs: 1, private: true });

  dbQueued = [
    [
      {
        sha: SHA_READY,
        repo: TEST_REPO,
        ref: "main",
        kind: "branch",
        pr_number: null,
        pr_title: null,
        pr_author: null,
        pr_state: null,
        doc_count: 0,
        build_ms: 0,
        blocked_at: null,
        trust_tier: null,
        private: true,
      },
    ], // getPreviewRow
    [], // isBlockedSha → false
    [], // touchPreview
  ];
  accessDecision = "ok";
  const pathname = `/api/preview/${SHA_READY}/events`;
  const res = handlePreview(new Request("http://x" + pathname), stubServer, pathname) as Response;
  const events = await readSSE(res);
  expect(events).toContainEqual({ phase: "ready", sha: SHA_READY });
  expect(accessCalls.some((c) => c.repo === TEST_REPO)).toBe(true); // the private+ok path really ran authorizePreviewAccess
});

test("/events: a ready private-PR bundle built without a PR base rebuilds once resolve now has one", async () => {
  const { handlePreview, previewPaths, writeMeta } = await freshHandler();
  const { inflightShas } = await import("./build.ts");
  const { __resetCachesForTest } = await import("./github-app.ts");
  __resetCachesForTest();

  const orig = {
    enabled: config.privatePreviewsEnabled,
    appId: config.githubAppId,
    key: config.githubAppPrivateKey,
    fetch: globalThis.fetch,
  };
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  config.privatePreviewsEnabled = true;
  config.githubAppId = "123";
  config.githubAppPrivateKey = privateKey.export({ type: "pkcs8", format: "pem" }) as string;

  const SHA = "5".repeat(40);
  makeReadyBundle(previewPaths, writeMeta, SHA, { private: true, repo: "octocat/grant-atlas" });
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    if (u.endsWith("/installation")) {
      return Response.json({
        id: 77,
        html_url: "https://github.com/settings/installations/77",
        permissions: { contents: "read", metadata: "read", pull_requests: "read" },
      });
    }
    if (u.endsWith("/access_tokens")) return Response.json({ token: "inst-tok" });
    if (u.includes("/pulls/")) {
      return Response.json({
        title: "Spark",
        user: { login: "alice" },
        state: "open",
        head: { sha: SHA, ref: "feat", repo: { full_name: "octocat/grant-atlas" } },
        base: { ref: "main", sha: "b".repeat(40), repo: { full_name: "octocat/grant-atlas" } },
      });
    }
    if (u.includes("/commits/")) return Response.json({ commit: { committer: { date: "2026-01-01T00:00:00Z" } } });
    if (u.includes("/tarball/")) return new Response("not found", { status: 404 });
    if (/\/repos\/[^/]+\/[^/]+$/.test(u)) return new Response("no", { status: 404 });
    return new Response("no", { status: 404 });
  }) as unknown as typeof fetch;

  try {
    accessDecision = "ok";
    dbQueued = [[], [], [{ sha: SHA }]];
    const id = encodeURIComponent("octocat:grant-atlas:pull-3");
    const pathname = `/api/preview/${id}/events`;
    const res = handlePreview(new Request("http://x" + pathname), stubServer, pathname) as Response;
    const events = await readSSE(res);
    expect(events).toContainEqual({ phase: "fetching", sha: SHA });
    expect(events.some((e) => e.phase === "ready")).toBe(false);
    expect(inflightShas().size).toBe(0);
  } finally {
    globalThis.fetch = orig.fetch;
    config.privatePreviewsEnabled = orig.enabled;
    config.githubAppId = orig.appId;
    config.githubAppPrivateKey = orig.key;
    accessDecision = "ok";
  }
});

test("/events: a ready Contents-only private-PR bundle is not rebuilt while Pulls is still unauthorized", async () => {
  const { handlePreview, previewPaths, writeMeta } = await freshHandler();
  const { inflightShas } = await import("./build.ts");
  const { __resetCachesForTest } = await import("./github-app.ts");
  __resetCachesForTest();

  const orig = {
    enabled: config.privatePreviewsEnabled,
    appId: config.githubAppId,
    key: config.githubAppPrivateKey,
    fetch: globalThis.fetch,
  };
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  config.privatePreviewsEnabled = true;
  config.githubAppId = "123";
  config.githubAppPrivateKey = privateKey.export({ type: "pkcs8", format: "pem" }) as string;

  const SHA = "4".repeat(40);
  makeReadyBundle(previewPaths, writeMeta, SHA, { private: true, repo: "octocat/grant-atlas" });
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    if (u.endsWith("/installation")) {
      return Response.json({
        id: 77,
        html_url: "https://github.com/settings/installations/77",
        permissions: { contents: "read", metadata: "read" },
      });
    }
    if (u.endsWith("/access_tokens")) return Response.json({ token: "inst-tok" });
    if (u.includes("/pulls/")) return new Response("no", { status: 404 });
    if (u.includes("/git/ref/")) return Response.json({ object: { sha: SHA } });
    if (u.includes("/commits/")) return Response.json({ commit: { committer: { date: "2026-01-01T00:00:00Z" } } });
    if (/\/repos\/[^/]+\/[^/]+$/.test(u)) return new Response("no", { status: 404 });
    return new Response("no", { status: 404 });
  }) as unknown as typeof fetch;

  try {
    accessDecision = "ok";
    dbQueued = [[], []]; // isBlockedSha → false, then touchPreview
    const id = encodeURIComponent("octocat:grant-atlas:pull-4");
    const pathname = `/api/preview/${id}/events`;
    const res = handlePreview(new Request("http://x" + pathname), stubServer, pathname) as Response;
    const events = await readSSE(res);
    expect(events).toContainEqual({ phase: "ready", sha: SHA });
    expect(events.some((e) => e.phase === "fetching")).toBe(false);
    expect(inflightShas().size).toBe(0);
  } finally {
    globalThis.fetch = orig.fetch;
    config.privatePreviewsEnabled = orig.enabled;
    config.githubAppId = orig.appId;
    config.githubAppPrivateKey = orig.key;
    accessDecision = "ok";
  }
});

test("syncBroadGrantMeta: clears, sets, and no-ops", async () => {
  const { syncBroadGrantMeta } = await import("./handler.ts");
  const base: PreviewMeta = {
    sha: "x", repo: "o/r", ref: "main", kind: "branch", resolvedAt: "t", docCount: 0, buildMs: 1,
    grantTooBroad: true, installSettingsUrl: "https://github.com/settings/installations/1",
  };
  expect(syncBroadGrantMeta(base, {})).toEqual({
    sha: "x", repo: "o/r", ref: "main", kind: "branch", resolvedAt: "t", docCount: 0, buildMs: 1,
  });
  const added = syncBroadGrantMeta(
    { sha: "x", repo: "o/r", ref: "main", kind: "branch", resolvedAt: "t", docCount: 0, buildMs: 1 },
    { grantTooBroad: true, installSettingsUrl: "https://github.com/settings/installations/1" },
  );
  expect(added?.grantTooBroad).toBe(true);
  expect(added?.installSettingsUrl).toBe("https://github.com/settings/installations/1");
  expect(syncBroadGrantMeta(base, { grantTooBroad: true, installSettingsUrl: "https://github.com/settings/installations/1" })).toBeNull();
});

test("/events: a ready private bundle drops grantTooBroad once the install is narrowed, without rebuilding", async () => {
  const { handlePreview, previewPaths, writeMeta, readMeta } = await freshHandler();
  const { inflightShas } = await import("./build.ts");
  const { __resetCachesForTest } = await import("./github-app.ts");
  __resetCachesForTest();

  const orig = {
    enabled: config.privatePreviewsEnabled,
    appId: config.githubAppId,
    key: config.githubAppPrivateKey,
    fetch: globalThis.fetch,
  };
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  config.privatePreviewsEnabled = true;
  config.githubAppId = "123";
  config.githubAppPrivateKey = privateKey.export({ type: "pkcs8", format: "pem" }) as string;

  const SHA = "ab".repeat(20);
  makeReadyBundle(previewPaths, writeMeta, SHA, {
    private: true,
    repo: "octocat/grant-atlas",
    extra: { grantTooBroad: true, installSettingsUrl: "https://github.com/settings/installations/77" },
  });
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    if (u.endsWith("/installation")) {
      return Response.json({
        id: 77,
        html_url: "https://github.com/settings/installations/77",
        permissions: { contents: "read", metadata: "read" },
        repository_selection: "selected",
      });
    }
    if (u.endsWith("/access_tokens")) return Response.json({ token: "inst-tok" });
    if (u.includes("/branches/")) return Response.json({ commit: { sha: SHA, commit: { committer: { date: "2026-01-01T00:00:00Z" } } } });
    if (/\/repos\/[^/]+\/[^/]+$/.test(u)) return new Response("no", { status: 404 });
    return new Response("no", { status: 404 });
  }) as unknown as typeof fetch;

  try {
    accessDecision = "ok";
    dbQueued = [[], []];
    const id = encodeURIComponent("octocat:grant-atlas:main");
    const pathname = `/api/preview/${id}/events`;
    const res = handlePreview(new Request("http://x" + pathname), stubServer, pathname) as Response;
    const events = await readSSE(res);
    expect(events).toContainEqual({ phase: "ready", sha: SHA });
    expect(events.some((e) => e.phase === "fetching")).toBe(false);
    expect(inflightShas().size).toBe(0);
    const meta = readMeta(SHA);
    expect(meta?.grantTooBroad).toBeUndefined();
    expect(meta?.installSettingsUrl).toBeUndefined();
  } finally {
    globalThis.fetch = orig.fetch;
    config.privatePreviewsEnabled = orig.enabled;
    config.githubAppId = orig.appId;
    config.githubAppPrivateKey = orig.key;
    accessDecision = "ok";
  }
});

test("/events: a ready private bundle gains grantTooBroad when the install is All repositories, without rebuilding", async () => {
  const { handlePreview, previewPaths, writeMeta, readMeta } = await freshHandler();
  const { inflightShas } = await import("./build.ts");
  const { __resetCachesForTest } = await import("./github-app.ts");
  __resetCachesForTest();

  const orig = {
    enabled: config.privatePreviewsEnabled,
    appId: config.githubAppId,
    key: config.githubAppPrivateKey,
    fetch: globalThis.fetch,
  };
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  config.privatePreviewsEnabled = true;
  config.githubAppId = "123";
  config.githubAppPrivateKey = privateKey.export({ type: "pkcs8", format: "pem" }) as string;

  const SHA = "ac".repeat(20);
  makeReadyBundle(previewPaths, writeMeta, SHA, { private: true, repo: "octocat/grant-atlas" });
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    if (u.endsWith("/installation")) {
      return Response.json({
        id: 77,
        html_url: "https://github.com/settings/installations/77",
        permissions: { contents: "read", metadata: "read" },
        repository_selection: "all",
      });
    }
    if (u.endsWith("/access_tokens")) return Response.json({ token: "inst-tok" });
    if (u.includes("/branches/")) return Response.json({ commit: { sha: SHA, commit: { committer: { date: "2026-01-01T00:00:00Z" } } } });
    if (/\/repos\/[^/]+\/[^/]+$/.test(u)) return new Response("no", { status: 404 });
    return new Response("no", { status: 404 });
  }) as unknown as typeof fetch;

  try {
    accessDecision = "ok";
    dbQueued = [[], []];
    const id = encodeURIComponent("octocat:grant-atlas:main");
    const pathname = `/api/preview/${id}/events`;
    const res = handlePreview(new Request("http://x" + pathname), stubServer, pathname) as Response;
    const events = await readSSE(res);
    expect(events).toContainEqual({ phase: "ready", sha: SHA });
    expect(events.some((e) => e.phase === "fetching")).toBe(false);
    expect(inflightShas().size).toBe(0);
    const meta = readMeta(SHA);
    expect(meta?.grantTooBroad).toBe(true);
    expect(meta?.installSettingsUrl).toBe("https://github.com/settings/installations/77");
  } finally {
    globalThis.fetch = orig.fetch;
    config.privatePreviewsEnabled = orig.enabled;
    config.githubAppId = orig.appId;
    config.githubAppPrivateKey = orig.key;
    accessDecision = "ok";
  }
});

test("/events: a pinned-sha visit does not wipe grantTooBroad (it never re-derives the flag)", async () => {
  const { handlePreview, previewPaths, writeMeta, readMeta } = await freshHandler();
  const SHA = "ad".repeat(20);
  makeReadyBundle(previewPaths, writeMeta, SHA, {
    private: true,
    extra: { grantTooBroad: true, installSettingsUrl: "https://github.com/settings/installations/1" },
  });

  dbQueued = [
    [
      {
        sha: SHA,
        repo: TEST_REPO,
        ref: "main",
        kind: "branch",
        pr_number: null,
        pr_title: null,
        pr_author: null,
        pr_state: null,
        doc_count: 0,
        build_ms: 0,
        blocked_at: null,
        trust_tier: null,
        private: true,
      },
    ],
    [],
    [],
  ];
  accessDecision = "ok";
  const pathname = `/api/preview/${SHA}/events`;
  const res = handlePreview(new Request("http://x" + pathname), stubServer, pathname) as Response;
  const events = await readSSE(res);
  expect(events).toContainEqual({ phase: "ready", sha: SHA });
  const meta = readMeta(SHA);
  expect(meta?.grantTooBroad).toBe(true);
  expect(meta?.installSettingsUrl).toBe("https://github.com/settings/installations/1");
});

test("/events: authorized deferred-private branch with no ready bundle completes the branch lookup and starts a real background build", async () => {
  const { handlePreview } = await freshHandler();
  const { inflightShas } = await import("./build.ts");
  const { __resetCachesForTest } = await import("./github-app.ts");
  __resetCachesForTest();

  const orig = {
    enabled: config.privatePreviewsEnabled,
    appId: config.githubAppId,
    key: config.githubAppPrivateKey,
    fetch: globalThis.fetch,
  };
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  config.privatePreviewsEnabled = true;
  config.githubAppId = "123";
  config.githubAppPrivateKey = privateKey.export({ type: "pkcs8", format: "pem" }) as string;

  const HAPPY_SHA = "6".repeat(39) + "e"; // distinct from every other sha in this file
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    if (u.endsWith("/installation")) return Response.json({ id: 77 });
    if (u.endsWith("/access_tokens")) return Response.json({ token: "inst-tok" });
    if (u.includes("/branches/")) return Response.json({ commit: { sha: HAPPY_SHA, commit: { committer: { date: "2026-01-01T00:00:00Z" } } } });
    // Real fetchAndExtract's tarball download — stubbed to fail fast (offline,
    // no real GitHub archive fetch) rather than left to hit the network. The
    // build then completes (fails) on its own instead of running unobserved.
    if (u.includes("/tarball/")) return new Response("not found", { status: 404 });
    if (/\/repos\/[^/]+\/[^/]+$/.test(u)) return new Response("no", { status: 404 }); // service token can't see the private repo
    return new Response("no", { status: 404 });
  }) as unknown as typeof fetch;

  try {
    accessDecision = "ok";
    // drive()'s isBlockedSha, then runBuild's own isBlockedSha + isKnownSha
    // (non-empty → "known" → skips the quota round-trip entirely).
    dbQueued = [[], [], [{ sha: HAPPY_SHA }]];
    const id = encodeURIComponent("octocat:secret-atlas:happy");
    const pathname = `/api/preview/${id}/events`;
    const res = handlePreview(new Request("http://x" + pathname), stubServer, pathname) as Response;
    const events = await readSSE(res);

    expect(events[0]).toEqual({ phase: "resolving" });
    // The branch→sha lookup really ran (only reachable post-auth, per G7) and a
    // real build really started — visible as a distinct "fetching" event for
    // the NEWLY resolved sha, then failing offline once the stubbed tarball
    // 404s (proves getOrStartBuild dispatched into the real runBuild, not a stub).
    expect(events).toContainEqual({ phase: "fetching", sha: HAPPY_SHA });
    expect(events).toContainEqual({
      phase: "failed",
      sha: HAPPY_SHA,
      code: "source-gone",
      message: `archive 404 for octocat/secret-atlas@${HAPPY_SHA}`,
    });
    expect(inflightShas().size).toBe(0); // the build ran to completion — nothing left dangling for a later test
  } finally {
    globalThis.fetch = orig.fetch;
    config.privatePreviewsEnabled = orig.enabled;
    config.githubAppId = orig.appId;
    config.githubAppPrivateKey = orig.key;
    accessDecision = "ok";
  }
});

// ---------------------------------------------------------------------------
// diffResponse: a bundle that ships its own diff.json (PR previews) is served
// directly, never falling through to the vs-main hash diff. setup()'s bundle
// never writes diff.json (it wants the vs-main fallback), and makeReadyBundle's
// callers so far only ever read docs.json/meta.json — so this path was
// genuinely never hit by a successful (non-denied) request.
// ---------------------------------------------------------------------------

test("diffResponse serves the bundle's own diff.json directly when present, without computing the vs-main fallback", async () => {
  const { call, previewPaths, writeMeta } = await freshHandler();
  const SHA_OWN_DIFF = "7".repeat(40);
  makeReadyBundle(previewPaths, writeMeta, SHA_OWN_DIFF, { private: false });
  const res = await call(`/api/preview/${SHA_OWN_DIFF}/diff.json`);
  expect(res.status).toBe(200);
  // Exactly what makeReadyBundle wrote — proves the bundle file was served
  // as-is, not recomputed against getIndexes().
  expect(await res.json()).toEqual({ added: [], changed: [] });
});

test("GET /api/preview/<sha>/diff.repo.json is served from the bundle when present, and 404s when absent", async () => {
  const { call, previewPaths, writeMeta } = await freshHandler();
  const SHA_DIFF_REPO = "f".repeat(40);
  makeReadyBundle(previewPaths, writeMeta, SHA_DIFF_REPO, { private: false });
  // makeReadyBundle writes docs.json + diff.json only — diff.repo.json (the
  // `repo`-candidate pair) is a distinct, allowlisted, optional artifact.
  const missing = await call(`/api/preview/${SHA_DIFF_REPO}/diff.repo.json`);
  expect(missing.status).toBe(404);

  fs.writeFileSync(
    path.join(previewPaths(SHA_DIFF_REPO).outDir, "diff.repo.json"),
    JSON.stringify({ added: ["x"], changed: [] }),
  );
  const present = await call(`/api/preview/${SHA_DIFF_REPO}/diff.repo.json`);
  expect(present.status).toBe(200);
  expect(await present.json()).toEqual({ added: ["x"], changed: [] });
});

// ---------------------------------------------------------------------------
// resolveId: sha-rebuild branch — kind + prBase reconstruction from a
// previews row. Exported directly from handler.ts so this doesn't need a full
// /events SSE round-trip or a real background build to observe.
// ---------------------------------------------------------------------------

test("resolveId: sha rebuild of a canonical PR row reconstructs kind 'pr' + prBase (no sha — base-drift re-resolves the tip)", async () => {
  const { resolveId } = await import("./handler.ts");
  const SHA_PR_ROW = "c".repeat(40);
  dbQueued = [
    [
      {
        sha: SHA_PR_ROW,
        repo: "sky-ecosystem/next-gen-atlas",
        ref: "pull-99",
        kind: "pr",
        pr_number: 99,
        pr_title: "Title",
        pr_author: "alice",
        pr_state: "open",
        doc_count: 1,
        build_ms: 1,
        blocked_at: null,
        trust_tier: null,
        private: false,
        pr_base_repo: "sky-ecosystem/next-gen-atlas",
        pr_base_ref: "main",
      },
    ],
  ];
  const r = await resolveId(SHA_PR_ROW);
  expect(r).toMatchObject({
    repo: "sky-ecosystem/next-gen-atlas",
    sha: SHA_PR_ROW,
    kind: "pr",
    pr: { number: 99, title: "Title", author: "alice", state: "open" },
    prBase: { repo: "sky-ecosystem/next-gen-atlas", ref: "main" },
  });
  expect((r as any).prBase.sha).toBeUndefined();
});

test("resolveId: sha rebuild of a plain branch row (null base columns) reconstructs kind 'branch' + no prBase", async () => {
  const { resolveId } = await import("./handler.ts");
  const SHA_BRANCH_ROW = "d".repeat(40);
  dbQueued = [
    [
      {
        sha: SHA_BRANCH_ROW,
        repo: "blimpa/next-gen-atlas",
        ref: "spark",
        kind: "branch",
        pr_number: null,
        pr_title: null,
        pr_author: null,
        pr_state: null,
        doc_count: 1,
        build_ms: 1,
        blocked_at: null,
        trust_tier: null,
        private: false,
        pr_base_repo: null,
        pr_base_ref: null,
        default_branch: "develop",
      },
    ],
  ];
  const r = await resolveId(SHA_BRANCH_ROW);
  expect(r).toMatchObject({ repo: "blimpa/next-gen-atlas", sha: SHA_BRANCH_ROW, kind: "branch", defaultBranch: "develop" });
  expect((r as any).prBase).toBeUndefined();
  expect((r as any).pr).toBeUndefined();
});

// ---------------------------------------------------------------------------
// /api/preview/list — untested by any existing case.
// ---------------------------------------------------------------------------

test("/api/preview/list returns the live rows on success, or [] if the query throws", async () => {
  const { call } = await freshHandler();
  dbQueued = [[{ sha: "abc", repo: "r/r", ref: "main" }]];
  const ok = await call("/api/preview/list");
  expect(ok.status).toBe(200);
  expect(await ok.json()).toEqual([{ sha: "abc", repo: "r/r", ref: "main" }]);

  dbQueued = [new Error("connection reset")];
  const failed = await call("/api/preview/list");
  expect(failed.status).toBe(200); // never surfaces the DB error to the client
  expect(await failed.json()).toEqual([]);
});
