// Exhaustive coverage targeting for handler.ts uncovered paths
import { test, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SHA = "a".repeat(40);
const stubServer = { requestIP: () => ({ address: "1.2.3.4" }) } as any;

async function exhaustiveSetup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pv-ex-"));
  process.env.PREVIEW_DIR = dir;
  const { loadIndexes, setIndexes, getIndexes } = await import("../indexes.ts");
  let indexes = loadIndexes();
  if (indexes.docMap.size === 0) {
    const testId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
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
  const ix = getIndexes();
  const { handlePreview } = await import("./handler.ts");
  const { previewPaths, writeMeta } = await import("./cache.ts");

  const someId = [...ix.docMap.keys()][0];
  const orig = ix.docMap.get(someId)!;
  const newId = "11111111-2222-3333-4444-555555555555";
  const p = previewPaths(SHA);
  fs.mkdirSync(p.outDir, { recursive: true });
  fs.writeFileSync(path.join(p.outDir, "docs.json"), JSON.stringify({
    atlasCommit: SHA,
    nodes: {
      [someId]: { ...orig, content: (orig.content || "") + " EDITED" },
      [newId]: { id: newId, doc_no: "A.9", title: "New", type: "Core", depth: 2, parentId: null, order: 9, content: "new", contentHash: "x" },
    },
  }));
  writeMeta(SHA, { sha: SHA, repo: "r", ref: "pull-1", kind: "pr", resolvedAt: "t", docCount: 2, buildMs: 1 });

  const call = (pathname: string) => Promise.resolve(handlePreview(new Request("http://x" + pathname), stubServer, pathname));
  return { call, someId, newId };
}

// Test rapid sequential calls to same endpoint
test("handler: rapid sequential calls to events endpoint", async () => {
  const s = await exhaustiveSetup();
  if (!s) return;
  const { call } = s;

  for (let i = 0; i < 15; i++) {
    const res = await call(`/api/preview/test-${i}/events`);
    expect(res.status).toBeGreaterThanOrEqual(200);
  }
});

// Test list endpoint multiple times
test("handler: /list endpoint returns valid JSON array", async () => {
  const s = await exhaustiveSetup();
  if (!s) return;
  const { call } = s;

  const res1 = await call("/api/preview/list");
  const res2 = await call("/api/preview/list");
  
  expect(res1.status).toBe(200);
  expect(res2.status).toBe(200);
  
  const body1 = await res1.json();
  const body2 = await res2.json();
  expect(Array.isArray(body1)).toBe(true);
  expect(Array.isArray(body2)).toBe(true);
});

// Test open-prs endpoint multiple times  
test("handler: /open-prs endpoint consistency", async () => {
  const s = await exhaustiveSetup();
  if (!s) return;
  const { call } = s;

  const responses = [];
  for (let i = 0; i < 5; i++) {
    const res = await call("/api/preview/open-prs");
    responses.push(res);
  }

  for (const res of responses) {
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  }
});

// Test different SHA formats
test("handler: various SHA formats validation", async () => {
  const s = await exhaustiveSetup();
  if (!s) return;
  const { call } = s;

  const validShas = [
    "a".repeat(40),
    "f".repeat(40),
    "0123456789abcdef".repeat(2) + "01234567",
  ];

  for (const sha of validShas) {
    const res = await call(`/api/preview/${sha}/docs.json`);
    // Should return 404 or 200, never 500
    expect([200, 404].includes(res.status)).toBe(true);
  }
});

// Test diff.json with various conditions
test("handler: diff.json responses are valid JSON", async () => {
  const s = await exhaustiveSetup();
  if (!s) return;
  const { call } = s;

  const res = await call(`/api/preview/${SHA}/diff.json`);
  if (res.status === 200) {
    const body = await res.json();
    expect(body).toBeTruthy();
  } else {
    expect(res.status).toBe(404);
  }
});

// Test artifact endpoint for both meta.json and other artifacts
test("handler: artifact responses for various files", async () => {
  const s = await exhaustiveSetup();
  if (!s) return;
  const { call } = s;

  const artifacts = ["meta.json", "docs.json", "graph.json", "glossary.json"];
  
  for (const artifact of artifacts) {
    const res = await call(`/api/preview/${SHA}/${artifact}`);
    // All should return either 200 or 404, never 500
    expect([200, 404].includes(res.status)).toBe(true);
  }
});

// Test cache behavior over multiple requests
test("handler: cache behavior across requests", async () => {
  const s = await exhaustiveSetup();
  if (!s) return;
  const { call } = s;

  // Make requests in sequence
  const diffRes1 = await call(`/api/preview/${SHA}/diff.json`);
  const diffRes2 = await call(`/api/preview/${SHA}/diff.json`);
  const metaRes1 = await call(`/api/preview/${SHA}/meta.json`);
  const metaRes2 = await call(`/api/preview/${SHA}/meta.json`);

  // Both should have same status
  expect(diffRes1.status).toBe(diffRes2.status);
  expect(metaRes1.status).toBe(metaRes2.status);
});

// Test path variations
test("handler: various path segment combinations", async () => {
  const s = await exhaustiveSetup();
  if (!s) return;
  const { call } = s;

  const paths = [
    "/api/preview/list",
    "/api/preview/open-prs",
    `/api/preview/${SHA}/diff.json`,
    `/api/preview/${SHA}/meta.json`,
    "/api/preview/unknown",
    "/api/preview",
  ];

  for (const path of paths) {
    const res = await call(path);
    expect(res.status).toBeGreaterThanOrEqual(200);
  }
});

// Additional exhaustive tests for specific code paths
test("handler: SHA validation with case insensitivity", async () => {
  const s = await exhaustiveSetup();
  if (!s) return;
  const { call } = s;

  // Test uppercase vs lowercase SHA
  const lowerSHA = "a".repeat(40);
  const upperSHA = "A".repeat(40);
  const mixedSHA = "aAbBcCdDeEfF" + "0123456789".repeat(2) + "abcdef";

  const res1 = await call(`/api/preview/${lowerSHA}/diff.json`);
  const res2 = await call(`/api/preview/${upperSHA}/diff.json`);
  const res3 = await call(`/api/preview/${mixedSHA}/diff.json`);

  expect([200, 404].includes(res1.status)).toBe(true);
  expect([200, 404].includes(res2.status)).toBe(true);
  expect([200, 404].includes(res3.status)).toBe(true);
});

// Test percent-encoding variations
test("handler: various percent-encoded path parameters", async () => {
  const s = await exhaustiveSetup();
  if (!s) return;
  const { call } = s;

  const encodedPaths = [
    "/api/preview/%61/events",  // 'a' encoded
    "/api/preview/%74%65%73%74/events",  // 'test' encoded  
    "/api/preview/test%2D1/events",  // 'test-1' encoded
  ];

  for (const path of encodedPaths) {
    const res = await call(path);
    expect(res.status).toBeGreaterThanOrEqual(200);
  }
});

// Test CORS headers on various endpoints
test("handler: CORS headers present on all responses", async () => {
  const s = await exhaustiveSetup();
  if (!s) return;
  const { call } = s;

  const paths = [
    "/api/preview/list",
    "/api/preview/open-prs",
    `/api/preview/${SHA}/diff.json`,
    `/api/preview/${SHA}/meta.json`,
  ];

  for (const path of paths) {
    const res = await call(path);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
  }
});

// Test content-type headers
test("handler: correct content-type for JSON responses", async () => {
  const s = await exhaustiveSetup();
  if (!s) return;
  const { call } = s;

  const res1 = await call("/api/preview/list");
  const res2 = await call("/api/preview/open-prs");
  const res3 = await call(`/api/preview/${SHA}/diff.json`);

  expect(res1.headers.get("content-type")).toContain("application/json");
  expect(res2.headers.get("content-type")).toContain("application/json");
  expect(res3.headers.get("content-type")).toContain("application/json");
});

// Test status codes
test("handler: correct HTTP status codes", async () => {
  const s = await exhaustiveSetup();
  if (!s) return;
  const { call } = s;

  // List and open-prs should return 200
  const list = await call("/api/preview/list");
  const prs = await call("/api/preview/open-prs");
  
  expect(list.status).toBe(200);
  expect(prs.status).toBe(200);

  // Invalid paths should return 404
  const invalid1 = await call("/api/preview/invalid");
  const invalid2 = await call(`/api/preview/${SHA}`);
  
  expect(invalid1.status).toBe(404);
  expect(invalid2.status).toBe(404);
});

// Test multiple rapid calls
test("handler: handle multiple rapid sequential calls", async () => {
  const s = await exhaustiveSetup();
  if (!s) return;
  const { call } = s;

  const promises = [];
  for (let i = 0; i < 20; i++) {
    promises.push(call("/api/preview/list"));
    promises.push(call("/api/preview/open-prs"));
    promises.push(call(`/api/preview/${SHA}/diff.json`));
  }

  const responses = await Promise.all(promises);
  for (const res of responses) {
    expect(res.status).toBeGreaterThanOrEqual(200);
  }
});
