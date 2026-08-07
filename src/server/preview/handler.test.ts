// Handler dispatch + diff + artifact serving. Needs built main artifacts
// (public/docs.json etc.) so diff has an in-memory baseline; skips otherwise.
// Run via `bun test`. PREVIEW_DIR is set before cache.ts is (dynamically) imported
// so it picks the scratch dir up — cache.ts freezes the value at import time.

import { test, expect, afterAll } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SHA = "a".repeat(40);
const stubServer = { requestIP: () => ({ address: "1.2.3.4" }) } as any;

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
