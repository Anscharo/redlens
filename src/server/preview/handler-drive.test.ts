// Covers handlePreview branches not exercised by handler.test.ts / open-prs.test.ts /
// unsub-gate.test.ts: the /list endpoint, the SSE /events pipeline (rate limiting,
// a resolve error, and the bundle-already-ready fast path), and diffResponse's
// "bundle ships its own diff.json" branch. Run via `bun test`.
//
// Uses the SAME shared PREVIEW_DIR the rest of the preview/*.test.ts files already
// write into (previewPaths()/writeMeta() default to it) — no directory setup of its
// own needed. Network (GitHub branch lookups) is stubbed via a global fetch swap,
// same convention as open-prs.test.ts. DB-backed calls (isBlockedSha, touchPreview,
// listPreviews) are all `.catch()`-guarded at their handler.ts call sites, so they
// degrade to their documented fallback with no Postgres available here.
import { test, expect, beforeAll, afterAll, mock } from "bun:test";
import fs from "node:fs";
import path from "node:path";

// preview/db.ts's `sql` (re-exported from ../db.ts) is stubbed to always
// resolve empty rows — no Postgres in this sandbox, and other test files
// (first-seen.test.ts, history.test.ts, auth.test.ts) also mock "./db.ts"
// for their own needs. `mock.module` replaces the module registry entry
// process-wide, and a static `import { sql } from "../db.ts"` (as preview/db.ts
// has) binds once, permanently, to whichever factory is active the FIRST time
// that module is loaded anywhere in the whole `bun test` run — this file is
// that first loader (it's the earliest file under src/server/preview/ to pull
// in handler.ts, which is the only path to preview/db.ts). Declaring our own
// stub here, before the dynamic import below, keeps every downstream/blocked-sha
// check ("not found"/"not blocked") deterministic regardless of what any other
// file's db mock last left `sql` doing.
mock.module("../db.ts", () => ({
  sql: Object.assign(() => Promise.resolve([]), { mock: true }),
}));

const stubServer = (ip: string) => ({ requestIP: () => ({ address: ip }) }) as any;

// Installed in beforeAll/afterAll (execution time), NOT at module top level:
// `bun test` imports every test file's top-level code before running ANY
// test body, so a bare top-level `globalThis.fetch = …` here would race
// open-prs.test.ts's own top-level swap — whichever file's module happens to
// be imported last during that collection pass wins, and the other file's
// requests silently go through the wrong stub (or the real network).
// beforeAll/afterAll run at execution time instead, right before/after this
// file's own tests, so they're immune to collection-order.
const realFetch = globalThis.fetch;
let fetchImpl: (url: string) => Promise<Response> = async () => new Response("{}", { status: 200 });
beforeAll(() => {
  // @ts-expect-error — minimal fetch stub, only the URL is inspected.
  globalThis.fetch = (input: RequestInfo | URL) => fetchImpl(String(input));
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

const { handlePreview } = await import("./handler.ts");
const { previewPaths, writeMeta } = await import("./cache.ts");

function call(ip: string, pathname: string): Promise<Response> {
  return Promise.resolve(handlePreview(new Request("http://x" + pathname), stubServer(ip), pathname));
}

async function readSSEEvents(res: Response): Promise<any[]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
  }
  return buf
    .split("\n\n")
    .filter((block) => block.includes("data: "))
    .map((block) => JSON.parse(block.slice(block.indexOf("data: ") + "data: ".length)));
}

test("list: DB unreachable degrades to [] with 200 (the .catch fallback), not a throw", async () => {
  const res = await call("198.51.100.1", "/api/preview/list");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([]);
});

test("events: a resolve error (branch not found on GitHub) sends a single failed event", async () => {
  fetchImpl = async () => new Response(JSON.stringify({ message: "Branch not found" }), { status: 404 });
  const res = await call("198.51.100.2", "/api/preview/no-such-branch-xyz/events");
  const events = await readSSEEvents(res);
  expect(events).toEqual([{ phase: "resolving" }, { phase: "failed", code: "not-found" }]);
});

test("events: a bundle that's already ready short-circuits straight to a ready event", async () => {
  const sha = "c".repeat(40);
  const p = previewPaths(sha);
  fs.mkdirSync(p.outDir, { recursive: true });
  fs.writeFileSync(path.join(p.outDir, "docs.json"), JSON.stringify({ atlasCommit: sha, nodes: {} }));
  writeMeta(sha, { sha, repo: "r", ref: "b", kind: "branch", resolvedAt: "t", docCount: 0, buildMs: 1 });

  fetchImpl = async () => new Response(JSON.stringify({ commit: { sha } }), { status: 200 });
  const res = await call("198.51.100.3", "/api/preview/already-ready-branch/events");
  const events = await readSSEEvents(res);
  expect(events).toEqual([{ phase: "resolving" }, { phase: "ready", sha }]);
});

test("events: the per-IP window rejects the 31st request within 10 minutes", async () => {
  const ip = "198.51.100.4";
  fetchImpl = async () => new Response(JSON.stringify({ message: "not found" }), { status: 404 });
  for (let i = 0; i < 30; i++) {
    await call(ip, `/api/preview/rl-branch-${i}/events`);
  }
  const res = await call(ip, "/api/preview/rl-branch-30/events");
  const events = await readSSEEvents(res);
  expect(events).toEqual([{ phase: "failed", code: "rate-limited", message: "Too many preview requests — try again shortly." }]);
}, 15_000);

test("diff.json: when the bundle ships its own diff.json, it's served verbatim instead of being computed", async () => {
  const sha = "d".repeat(40);
  const p = previewPaths(sha);
  fs.mkdirSync(p.outDir, { recursive: true });
  fs.writeFileSync(path.join(p.outDir, "docs.json"), JSON.stringify({ atlasCommit: sha, nodes: {} }));
  const shippedDiff = { added: ["shipped-a"], changed: ["shipped-b"] };
  fs.writeFileSync(path.join(p.outDir, "diff.json"), JSON.stringify(shippedDiff));
  writeMeta(sha, { sha, repo: "r", ref: "pull-1", kind: "pr", resolvedAt: "t", docCount: 0, buildMs: 1 });

  const res = await call("198.51.100.5", `/api/preview/${sha}/diff.json`);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual(shippedDiff);
});
