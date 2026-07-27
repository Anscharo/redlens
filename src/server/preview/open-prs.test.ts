// GET /api/preview/open-prs — the "open atlas prs" tab's data source. The
// handler holds a module-level GitHub client that calls the global `fetch`, so
// we drive it by swapping `globalThis.fetch`. Run via `bun test`.
//
// The endpoint memoizes for ~5min, and bun has a real clock, so the cache can't
// be expired mid-test. We exploit module-level ordering instead: an early call
// (empty cache) exercises the error fallback, a later call populates the cache,
// and a third proves the cache is served without re-hitting GitHub. The
// stale-on-error branch (cached value returned after a failed refresh) is the
// same code path as the cache-hit return and isn't separately reachable here.

import { test, expect, afterAll, beforeAll } from "bun:test";

const stubServer = { requestIP: () => ({ address: "1.2.3.4" }) } as any;
const realFetch = globalThis.fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});

let fetchCalls = 0;
let nextResponse: () => Promise<Response>;
let handlePreview: (req: Request, server: typeof stubServer, pathname: string) => Response | Promise<Response>;
beforeAll(async () => {
  // @ts-expect-error — minimal fetch stub, only the pulls path is exercised.
  globalThis.fetch = (input: RequestInfo | URL) => {
    fetchCalls++;
    expect(String(input)).toContain("/repos/sky-ecosystem/next-gen-atlas/pulls");
    return nextResponse();
  };
  ({ handlePreview } = await import("./handler.ts"));
});

const call = (p: string) => Promise.resolve(handlePreview(new Request("http://x" + p), stubServer, p));
const ghJson = (body: unknown, ok = true) =>
  Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response);

test("open-prs: empty cache + GitHub error → []", async () => {
  nextResponse = () => ghJson({ message: "rate limited" }, false);
  const res = await call("/api/preview/open-prs");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([]);
});

test("open-prs: maps GitHub's pulls payload, defaulting missing fields", async () => {
  nextResponse = () =>
    ghJson([
      { number: 256, title: "Atomize docs", user: { login: "bob" }, draft: false, updated_at: "2026-06-30T00:00:00Z" },
      { number: 257 }, // no title/user/draft/updated_at → safe defaults
    ]);
  const before = fetchCalls;
  const prs = (await (await call("/api/preview/open-prs")).json()) as any[];
  expect(fetchCalls).toBe(before + 1); // cache was empty → one GitHub call
  expect(prs).toEqual([
    { number: 256, title: "Atomize docs", author: "bob", draft: false, updatedAt: "2026-06-30T00:00:00Z" },
    { number: 257, title: "", author: "", draft: false, updatedAt: "" },
  ]);
});

test("open-prs: serves the cached list without re-hitting GitHub", async () => {
  const before = fetchCalls;
  const prs = (await (await call("/api/preview/open-prs")).json()) as any[];
  expect(fetchCalls).toBe(before); // within TTL → no new GitHub call
  expect(prs.map((p) => p.number)).toEqual([256, 257]);
});
