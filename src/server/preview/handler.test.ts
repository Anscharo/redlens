// Handler dispatch + diff + artifact serving. Needs built main artifacts
// (public/docs.json etc.) so diff has an in-memory baseline; skips otherwise.
// Run via `bun test`. previewEnabled/PREVIEW_DIR are set before a dynamic import
// so config + cache pick them up.

import { test, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SHA = "a".repeat(40);
const stubServer = { requestIP: () => ({ address: "1.2.3.4" }) } as any;

async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pv-h-"));
  process.env.PREVIEW_DIR = dir;
  // config is a singleton that may already be loaded (env-at-import won't take);
  // flip the flag on the object directly so the handler isn't gated off.
  const { config } = await import("../config.ts");
  config.previewEnabled = true;
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
  expect((await (await call(`/api/preview/${SHA}/meta.json`)).json()).docCount).toBe(2);

  const diff = await (await call(`/api/preview/${SHA}/diff.json`)).json();
  expect(diff.added).toContain(newId);
  expect(diff.changed).toContain(someId);

  // on-chain artifact reused from main → not allowlisted
  expect((await call(`/api/preview/${SHA}/addresses.json`)).status).toBe(404);
  // non-40-hex sha rejected
  expect((await call(`/api/preview/zzz/docs.json`)).status).toBe(404);
  // unknown bundle → 404
  expect((await call(`/api/preview/${"b".repeat(40)}/docs.json`)).status).toBe(404);
});
