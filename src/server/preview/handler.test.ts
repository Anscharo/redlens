// Handler dispatch + diff + artifact serving. Needs built main artifacts
// (public/docs.json etc.) so diff has an in-memory baseline; skips otherwise.
// Run via `bun test`. PREVIEW_DIR is set before a dynamic import so cache picks it up.

import { test, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SHA = "a".repeat(40);
const stubServer = { requestIP: () => ({ address: "1.2.3.4" }) } as any;

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

test("handler: makeUnsubGate handles cancellation before resolution", async () => {
  const { makeUnsubGate } = await import("./handler.ts");
  const gate = makeUnsubGate();

  let unsubCalled = false;
  gate.cancel();
  gate.resolve(() => {
    unsubCalled = true;
  });

  expect(unsubCalled).toBe(true);
});

test("handler: makeUnsubGate handles resolution before cancellation", async () => {
  const { makeUnsubGate } = await import("./handler.ts");
  const gate = makeUnsubGate();

  let unsubCalled = false;
  gate.resolve(() => {
    unsubCalled = true;
  });
  gate.cancel();

  expect(unsubCalled).toBe(true);
});

test("handler: makeUnsubGate cancels idempotently", async () => {
  const { makeUnsubGate } = await import("./handler.ts");
  const gate = makeUnsubGate();

  let callCount = 0;
  gate.resolve(() => {
    callCount++;
  });

  gate.cancel();
  gate.cancel();
  gate.cancel();

  expect(callCount).toBe(1);
});

test("handler: invalid SHA format returns 404", async () => {
  const s = await setup();
  if (!s) {
    console.warn("handler.test: no built main artifacts — skipped");
    return;
  }
  const { call } = s;

  expect((await call("/api/preview/not-a-sha/diff.json")).status).toBe(404);
  expect((await call("/api/preview/12345/docs.json")).status).toBe(404);
  expect((await call("/api/preview/gggggggggggggggggggggggggggggggggggggg/meta.json")).status).toBe(404);
});

test("handler: unknown artifact paths return 404", async () => {
  const s = await setup();
  if (!s) {
    console.warn("handler.test: no built main artifacts — skipped");
    return;
  }
  const { call } = s;

  expect((await call(`/api/preview/${SHA}/unknown-artifact.json`)).status).toBe(404);
  expect((await call(`/api/preview/${SHA}/glossary.json`)).status).toBe(404);
  expect((await call(`/api/preview/${SHA}/graph.json`)).status).toBe(404);
});

test("handler: CORS headers are present in responses", async () => {
  const s = await setup();
  if (!s) {
    console.warn("handler.test: no built main artifacts — skipped");
    return;
  }
  const { call } = s;

  const res = await call(`/api/preview/${SHA}/meta.json`);
  expect(res.headers.get("access-control-allow-origin")).toBe("*");
  expect(res.headers.get("x-robots-tag")).toBe("noindex");
});

test("handler: /preview/list endpoint returns JSON array", async () => {
  const s = await setup();
  if (!s) {
    console.warn("handler.test: no built main artifacts — skipped");
    return;
  }
  const { call } = s;

  const res = await call("/api/preview/list");
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("application/json");
  const body = await res.json();
  expect(Array.isArray(body)).toBe(true);
});

test("handler: /preview/open-prs endpoint returns JSON array", async () => {
  const s = await setup();
  if (!s) {
    console.warn("handler.test: no built main artifacts — skipped");
    return;
  }
  const { call } = s;

  const res = await call("/api/preview/open-prs");
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("application/json");
  const body = await res.json();
  expect(Array.isArray(body)).toBe(true);
});

test("handler: wrong number of path segments returns 404", async () => {
  const s = await setup();
  if (!s) {
    console.warn("handler.test: no built main artifacts — skipped");
    return;
  }
  const { call } = s;

  expect((await call("/api/preview/")).status).toBe(404);
  expect((await call(`/api/preview/${SHA}`)).status).toBe(404);
  expect((await call(`/api/preview/${SHA}/sub/path`)).status).toBe(404);
  expect((await call(`/api/preview/${SHA}/a/b/c`)).status).toBe(404);
});

test("handler: /events endpoint returns SSE response", async () => {
  const s = await setup();
  if (!s) {
    console.warn("handler.test: no built main artifacts — skipped");
    return;
  }
  const { call } = s;

  const res = await call("/api/preview/main/events");
  expect(res.status).toBeGreaterThanOrEqual(200);
  expect(res.headers.get("content-type")).toBe("text/event-stream");
});
