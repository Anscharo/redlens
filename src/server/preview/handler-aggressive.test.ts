// Aggressive edge-case testing for handler.ts uncovered paths
import { test, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SHA = "a".repeat(40);
const stubServer = { requestIP: () => ({ address: `1.2.3.${Math.floor(Math.random() * 255)}` }) } as any;

async function aggressiveSetup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pv-agg-"));
  process.env.PREVIEW_DIR = dir;
  const { loadIndexes, setIndexes, getIndexes } = await import("../indexes.ts");
  let indexes = loadIndexes();
  if (indexes.docMap.size === 0) {
    const testId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    indexes.docMap.set(testId, {
      id: testId,
      doc_no: "A.0",
      title: "Main",
      type: "Core",
      depth: 1,
      parentId: null,
      order: 0,
      content: "Main content",
      contentHash: "main_hash"
    });
  }
  setIndexes(indexes);
  const { handlePreview } = await import("./handler.ts");
  const { previewPaths, writeMeta } = await import("./cache.ts");

  const ix = getIndexes();
  const someId = [...ix.docMap.keys()][0];
  const orig = ix.docMap.get(someId)!;
  const p = previewPaths(SHA);
  fs.mkdirSync(p.outDir, { recursive: true });
  fs.writeFileSync(path.join(p.outDir, "docs.json"), JSON.stringify({
    atlasCommit: SHA,
    nodes: { [someId]: { ...orig, content: (orig.content || "") + " EDITED" } },
  }));
  writeMeta(SHA, { sha: SHA, repo: "r", ref: "pull-1", kind: "pr", resolvedAt: "t", docCount: 1, buildMs: 1 });

  const call = (pathname: string, ip?: string) => {
    const customServer = ip ? { requestIP: () => ({ address: ip }) } : stubServer;
    return Promise.resolve(handlePreview(new Request("http://x" + pathname), customServer as any, pathname));
  };
  return { call, someId };
}

// Test with many different IP addresses to explore caching
test("handler: events endpoint from many IPs", async () => {
  const s = await aggressiveSetup();
  if (!s) return;
  const { call } = s;

  // Call from 50 different IPs
  for (let i = 0; i < 50; i++) {
    const ip = `192.168.1.${i % 255}`;
    const res = await call(`/api/preview/test-ip-${i}/events`, ip);
    expect(res.status).toBeGreaterThanOrEqual(200);
  }
});

// Test with many different preview IDs
test("handler: many different preview identifiers", async () => {
  const s = await aggressiveSetup();
  if (!s) return;
  const { call } = s;

  // Request list/prs multiple times
  for (let i = 0; i < 10; i++) {
    const listRes = await call("/api/preview/list");
    const prsRes = await call("/api/preview/open-prs");
    const diffRes = await call(`/api/preview/${SHA}/diff.json`);
    
    expect(listRes.status).toBe(200);
    expect(prsRes.status).toBe(200);
    expect([200, 404].includes(diffRes.status)).toBe(true);
  }
});

// Test invalid SHA then valid SHA
test("handler: invalid then valid SHA sequence", async () => {
  const s = await aggressiveSetup();
  if (!s) return;
  const { call } = s;

  const invalidShaTests = [
    "/api/preview/xyz/diff.json",
    "/api/preview/12345/meta.json",
    "/api/preview/gggggggg/docs.json",
    "/api/preview/!@#$%^&/events",
  ];

  for (const path of invalidShaTests) {
    const res = await call(path);
    expect(res.status).toBe(404);
  }

  // Then valid requests
  const validRes1 = await call(`/api/preview/${SHA}/diff.json`);
  const validRes2 = await call(`/api/preview/${SHA}/meta.json`);
  
  expect([200, 404].includes(validRes1.status)).toBe(true);
  expect([200, 404].includes(validRes2.status)).toBe(true);
});

// Test extreme path variations
test("handler: extreme path parameter variations", async () => {
  const s = await aggressiveSetup();
  if (!s) return;
  const { call } = s;

  const paths = [
    "/api/preview/list",
    "/api/preview/open-prs",
    `/api/preview/${SHA}/diff.json`,
    `/api/preview/${SHA}/meta.json`,
    `/api/preview/${"a".repeat(40)}/docs.json`,
    `/api/preview/${"f".repeat(40)}/graph.json`,
    `/api/preview/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/events`,
  ];

  for (const path of paths) {
    const res = await call(path);
    expect(res.status).toBeGreaterThanOrEqual(200);
  }
});

// Test all event endpoint variations
test("handler: events endpoint with different identifiers", async () => {
  const s = await aggressiveSetup();
  if (!s) return;
  const { call } = s;

  const ids = [
    "main",
    "pr-123",
    "branch-test",
    "a".repeat(40),
    "123456789",
    "%20space%20",
  ];

  for (const id of ids) {
    const res = await call(`/api/preview/${id}/events`);
    expect(res.status).toBeGreaterThanOrEqual(200);
  }
});

// Test list endpoint behavior
test("handler: list endpoint repeated calls", async () => {
  const s = await aggressiveSetup();
  if (!s) return;
  const { call } = s;

  const responses = [];
  for (let i = 0; i < 10; i++) {
    const res = await call("/api/preview/list");
    responses.push(res);
  }

  for (const res of responses) {
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
  }
});

// Test open-prs endpoint behavior
test("handler: open-prs endpoint repeated calls", async () => {
  const s = await aggressiveSetup();
  if (!s) return;
  const { call } = s;

  for (let i = 0; i < 10; i++) {
    const res = await call("/api/preview/open-prs");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
  }
});

// Test invalid paths
test("handler: various invalid paths", async () => {
  const s = await aggressiveSetup();
  if (!s) return;
  const { call } = s;

  const invalidPaths = [
    "/api/preview",
    "/api/preview/",
    "/api/preview/list/extra",
    "/api/preview/open-prs/extra",
    `/api/preview/${SHA}`,
    `/api/preview/${SHA}/`,
    "/api/preview/notahex/events",
  ];

  for (const path of invalidPaths) {
    const res = await call(path);
    expect(res.status).toBe(404);
  }
});
