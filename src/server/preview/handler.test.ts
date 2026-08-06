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
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type AccessDecision = "ok" | "login-required" | "forbidden" | "unavailable";
let accessDecision: AccessDecision = "ok";
let accessCalls: { repo: string }[] = [];
mock.module("./access.ts", () => ({
  authorizePreviewAccess: (_req: Request, repo: string) => {
    accessCalls.push({ repo });
    return Promise.resolve(accessDecision);
  },
}));

let dbQueued: unknown[] = [];
mock.module("../db.ts", () => ({
  sql(_strings: TemplateStringsArray, ..._values: unknown[]) {
    return Promise.resolve(dbQueued.shift() ?? []);
  },
  dbTarget: () => "mock-db",
  waitForDb: () => Promise.resolve(),
  toVectorLiteral: (vec: number[]) => `[${vec.join(",")}]`,
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

async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pv-h-"));
  process.env.PREVIEW_DIR = dir;
  const { loadIndexes, setIndexes, getIndexes } = await import("../retrieval/indexes.ts");
  setIndexes(loadIndexes());
  const ix = getIndexes();
  if (ix.docMap.size === 0) return null; // no built artifacts → skip
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

test("handler: artifact + meta served, diff vs main, allowlist + sha validation", async () => {
  const s = await setup();
  if (!s) {
    console.warn("handler.test: no built main artifacts — skipped");
    return;
  }
  const { call, someId, newId } = s;

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

test("handler: malformed percent-encoding on the events id returns 404, not a 500", async () => {
  const s = await setup();
  if (!s) {
    console.warn("handler.test: no built main artifacts — skipped");
    return;
  }
  const { call } = s;
  // A lone "%" or an incomplete escape throws inside decodeURIComponent.
  const res = await call("/api/preview/%E0%A4%A/events");
  expect(res.status).toBe(404);
});

test("handler: diffCache evicts FIFO once it exceeds DIFF_CACHE_MAX", async () => {
  const s = await setup();
  if (!s) {
    console.warn("handler.test: no built main artifacts — skipped");
    return;
  }
  const { call } = s;
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
  const { previewPaths, writeMeta } = await import("./cache.ts");
  const call = (pathname: string) => Promise.resolve(handlePreview(new Request("http://x" + pathname), stubServer, pathname));
  return { call, handlePreview, previewPaths, writeMeta };
}

function makeReadyBundle(
  previewPaths: (sha: string) => { outDir: string },
  writeMeta: (sha: string, meta: Record<string, unknown>) => void,
  sha: string,
  opts: { private?: boolean; repo?: string } = {},
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
