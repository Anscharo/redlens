// Handler dispatch + diff + artifact serving. Needs built main artifacts
// (public/docs.json etc.) so diff has an in-memory baseline; skips otherwise.
// Run via `bun test`. PREVIEW_DIR is set before a dynamic import so cache picks it up.

import { test, expect, mock } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SHA = "a".repeat(40);
const stubServerAt = (ip: string) => ({ requestIP: () => ({ address: ip }) }) as any;
const stubServer = stubServerAt("1.2.3.4");

async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pv-h-"));
  process.env.PREVIEW_DIR = dir;
  const { loadIndexes, setIndexes, getIndexes } = await import("../indexes.ts");
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
// GET /api/preview/list
// ---------------------------------------------------------------------------

// mock.module overwrites an already-loaded module's exports in place (bun
// doesn't reliably undo this across files even with mock.restore()), and
// preview/db.ts is imported by build.ts/sweeper.ts too. Always stub the FULL
// export surface with safe no-op defaults so a leak into another test file
// degrades gracefully instead of throwing on a missing export.
function dbStub(overrides: Record<string, () => unknown> = {}) {
  return () => ({
    upsertPreview: () => Promise.resolve(),
    getPreviewRow: () => Promise.resolve(null),
    isKnownSha: () => Promise.resolve(false),
    touchPreview: () => Promise.resolve(),
    previewsTodayCount: () => Promise.resolve(0),
    previewsTodayCountForOwner: () => Promise.resolve(0),
    listPreviews: () => Promise.resolve([]),
    isBlockedSha: () => Promise.resolve(false),
    blockedShas: () => Promise.resolve(new Set()),
    ...overrides,
  });
}

test("handler: list serves the DB rows, and degrades to [] instead of failing when the DB errors", async () => {
  const s = await setup();
  if (!s) {
    console.warn("handler.test: no built main artifacts — skipped");
    return;
  }
  const { call } = s;

  try {
    mock.module("./db.ts", dbStub({ listPreviews: () => Promise.resolve([{ sha: "x".repeat(40), repo: "r", ref: "b" }]) }));
    const ok = await call("/api/preview/list");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual([{ sha: "x".repeat(40), repo: "r", ref: "b" }]);

    mock.module("./db.ts", dbStub({ listPreviews: () => Promise.reject(new Error("connection refused")) }));
    const errored = await call("/api/preview/list");
    expect(errored.status).toBe(200);
    expect(await errored.json()).toEqual([]);
  } finally {
    mock.module("./db.ts", dbStub());
  }
});

// ---------------------------------------------------------------------------
// GET /api/preview/:id/events — the SSE drive() flow. GitHub is stubbed via
// globalThis.fetch (same pattern as open-prs.test.ts); no real network/build.
// ---------------------------------------------------------------------------

const GH_BRANCHES_RE = /\/repos\/sky-ecosystem\/next-gen-atlas\/branches\/([^/?]+)$/;

async function readSseEvents(res: Response): Promise<Record<string, unknown>[]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const events: Record<string, unknown>[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const m = /^data: (.+)$/m.exec(chunk);
      if (m) events.push(JSON.parse(m[1]));
    }
  }
  return events;
}

test("handler: events — resolves a branch, finds the bundle already built, and streams resolving → ready", async () => {
  const s = await setup();
  if (!s) {
    console.warn("handler.test: no built main artifacts — skipped");
    return;
  }
  const { call } = s;
  const { previewPaths, writeMeta } = await import("./cache.ts");

  const sha = "d".repeat(40);
  const p = previewPaths(sha);
  fs.mkdirSync(p.outDir, { recursive: true });
  fs.writeFileSync(path.join(p.outDir, "docs.json"), JSON.stringify({ atlasCommit: sha, nodes: {} }));
  writeMeta(sha, { sha, repo: "r", ref: "ready-branch", kind: "branch", resolvedAt: "t", docCount: 0, buildMs: 1 });

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (GH_BRANCHES_RE.test(url)) return new Response(JSON.stringify({ commit: { sha } }), { status: 200 });
    throw new Error(`unstubbed fetch in test: ${url}`);
  }) as unknown as typeof fetch;

  try {
    const res = await call("/api/preview/ready-branch/events");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    const events = await readSseEvents(res);
    expect(events[0]).toEqual({ phase: "resolving" });
    expect(events.at(-1)).toEqual({ phase: "ready", sha });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("handler: events — an unresolvable branch streams resolving → failed(not-found)", async () => {
  const s = await setup();
  if (!s) {
    console.warn("handler.test: no built main artifacts — skipped");
    return;
  }
  const { call } = s;

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (GH_BRANCHES_RE.test(url)) return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
    throw new Error(`unstubbed fetch in test: ${url}`);
  }) as unknown as typeof fetch;

  try {
    const res = await call("/api/preview/no-such-branch/events");
    const events = await readSseEvents(res);
    expect(events).toEqual([{ phase: "resolving" }, { phase: "failed", code: "not-found" }]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("handler: events — a blocked sha is evicted and reported not-found instead of served/rebuilt", async () => {
  const s = await setup();
  if (!s) {
    console.warn("handler.test: no built main artifacts — skipped");
    return;
  }
  const { call } = s;
  const { previewPaths, writeMeta } = await import("./cache.ts");

  const sha = "e".repeat(40);
  const p = previewPaths(sha);
  fs.mkdirSync(p.outDir, { recursive: true });
  fs.writeFileSync(path.join(p.outDir, "docs.json"), JSON.stringify({ atlasCommit: sha, nodes: {} }));
  writeMeta(sha, { sha, repo: "r", ref: "blocked-branch", kind: "branch", resolvedAt: "t", docCount: 0, buildMs: 1 });

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (GH_BRANCHES_RE.test(url)) return new Response(JSON.stringify({ commit: { sha } }), { status: 200 });
    throw new Error(`unstubbed fetch in test: ${url}`);
  }) as unknown as typeof fetch;
  mock.module("./db.ts", dbStub({ isBlockedSha: () => Promise.resolve(true) }));

  try {
    const res = await call("/api/preview/blocked-branch/events");
    const events = await readSseEvents(res);
    expect(events).toEqual([{ phase: "resolving" }, { phase: "failed", code: "not-found" }]);
    expect(fs.existsSync(p.outDir)).toBe(false); // removeBundle(sha) evicted it
  } finally {
    globalThis.fetch = realFetch;
    mock.module("./db.ts", dbStub());
  }
});

test("handler: events — a client past the per-IP rate limit gets failed(rate-limited) without resolving", async () => {
  const s = await setup();
  if (!s) {
    console.warn("handler.test: no built main artifacts — skipped");
    return;
  }
  const ip = "203.0.113.77"; // TEST-NET-3, unique to this test
  const { handlePreview } = await import("./handler.ts");
  const callAt = (pathname: string) => Promise.resolve(handlePreview(new Request("http://x" + pathname), stubServerAt(ip), pathname));

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (GH_BRANCHES_RE.test(url)) return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
    throw new Error(`unstubbed fetch in test: ${url}`);
  }) as unknown as typeof fetch;

  try {
    // 30 requests (same rawId → cached after the first) stay under IP_LIMIT.
    for (let i = 0; i < 30; i++) {
      const events = await readSseEvents(await callAt("/api/preview/rate-limit-probe/events"));
      expect(events.at(-1)).toEqual({ phase: "failed", code: "not-found" });
    }
    // The 31st trips the limiter before resolving ever runs.
    const events = await readSseEvents(await callAt("/api/preview/rate-limit-probe/events"));
    expect(events).toEqual([{ phase: "failed", code: "rate-limited", message: "Too many preview requests — try again shortly." }]);
  } finally {
    globalThis.fetch = realFetch;
  }
}, 20_000);
