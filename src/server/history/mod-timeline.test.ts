// Run under `bun test` (NOT vitest) — imports Bun SQL transitively via ../db.ts.
//
// DB MOCKING SHAPE — see history.test.ts's header for the full write-up. The
// short version: bun's `mock.module` patches the module registry for the REST
// OF THE PROCESS, and `mock.restore()` does NOT undo it. This file used to call
// `mock.module("../db.ts", …)` from inside seven `it()` bodies, each supplying
// ONLY `sql` — so the moment this file had run, db.ts had permanently lost
// `toVectorLiteral`/`dbTarget`/`waitForDb`, and the next file to import one of
// those died at link time ("Export named 'toVectorLiteral' not found in module
// …/db.ts"). That is a module-link error, not an assertion, so it takes out a
// whole file. `bun test` walks files in readdir order (and reorders explicit
// CLI args), so which file got hit varied by machine and by checkout.
//
// There is now exactly ONE module-scope registration, spreading the eagerly
// snapshotted real namespace so no export is ever dropped. mod-timeline.ts
// calls `sql.unsafe(…)` rather than the tagged-template form, so what swaps
// here is `unsafeImpl` (armed per case, disarmed in beforeEach/afterEach);
// disarmed, `.unsafe` forwards to the real client, which makes the
// registration a behavioural no-op for every file scheduled after this one.
import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";

// EAGER snapshot into plain consts: a module namespace object is LIVE, so
// reading `ns.sql` after the mock lands would resolve to our own dispatcher and
// recurse until the stack blows.
const baseNs = await import("../db.ts");
const baseExports: Record<string, unknown> = { ...baseNs };
const baseSql = baseNs.sql as unknown as Record<PropertyKey, unknown> | undefined;

type SqlImpl = (...args: unknown[]) => unknown;
let unsafeImpl: SqlImpl | null = null;

// A real function, not `new Proxy(baseSql, {apply})`: migrate.test.ts replaces
// `sql` with a non-callable object, and a Proxy over a non-callable target is
// itself not callable — which would kill the tagged-template form for every
// file that inherits this registration, even though this file never uses it.
function sqlCall(...args: unknown[]): unknown {
  if (typeof baseSql !== "function") {
    throw new Error("db.ts `sql` is not callable — an earlier test file replaced it with a non-callable stub");
  }
  return (baseSql as SqlImpl)(...args);
}

// `.unsafe` is this file's seam; every other non-call member (`.reserve`/
// `.begin` for migrate.ts) forwards to the snapshot so later files keep
// whatever they had.
const FN_OWN = new Set<PropertyKey>(["length", "name", "prototype", "constructor", "call", "apply", "bind"]);
const sqlDispatch = new Proxy(sqlCall, {
  get(target, prop, receiver) {
    if (prop === "unsafe" && unsafeImpl) return unsafeImpl;
    if (baseSql && !FN_OWN.has(prop)) {
      const v = baseSql[prop];
      if (v !== undefined) return typeof v === "function" ? (v as SqlImpl).bind(baseSql) : v;
    }
    return Reflect.get(target, prop, receiver);
  },
});

mock.module("../db.ts", () => ({ ...baseExports, sql: sqlDispatch }));

const { handleModTimeline } = await import("./mod-timeline.ts");

function reqFor(url: string): Request {
  return new Request(url);
}

describe("handleModTimeline", () => {
  // Disarm on both edges so no case leaks its impl into a sibling — or, once
  // this file finishes, into another test file.
  beforeEach(() => {
    unsafeImpl = null;
  });
  afterEach(() => {
    unsafeImpl = null;
  });

  it("defaults to month granularity and maps rows to {period, count}", async () => {
    unsafeImpl = () =>
      Promise.resolve([
        { period: "2026-01", count: 5 },
        { period: "2026-02", count: 12 },
      ]);
    const res = await handleModTimeline(reqFor("https://x/api/history/mod-timeline"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { period: "2026-01", count: 5 },
      { period: "2026-02", count: 12 },
    ]);
  });

  it("granularity=week maps rows to {period, count}", async () => {
    unsafeImpl = () => Promise.resolve([{ period: "2026-01-05", count: 3 }]);
    const res = await handleModTimeline(reqFor("https://x/api/history/mod-timeline?granularity=week"));
    expect(await res.json()).toEqual([{ period: "2026-01-05", count: 3 }]);
  });

  it("granularity=commit maps rows to {seq, sha, date, count} and normalises the date", async () => {
    unsafeImpl = () =>
      Promise.resolve([
        { seq: 42, sha: "a1b2c3d4e5f6", date: new Date("2026-01-05T10:00:00-07:00"), count: 2 },
        { seq: 43, sha: "mip:104:14.3", date: null, count: 1 },
      ]);
    const res = await handleModTimeline(reqFor("https://x/api/history/mod-timeline?granularity=commit"));
    expect(await res.json()).toEqual([
      { seq: 42, sha: "a1b2c3d4e5f6", date: "2026-01-05", count: 2 },
      { seq: 43, sha: "mip:104:14.3", date: null, count: 1 },
    ]);
  });

  it("an unrecognized granularity value falls back to month", async () => {
    unsafeImpl = () => Promise.resolve([{ period: "2026-01", count: 1 }]);
    const res = await handleModTimeline(reqFor("https://x/api/history/mod-timeline?granularity=year"));
    expect(await res.json()).toEqual([{ period: "2026-01", count: 1 }]);
  });

  it("sets Cache-Control on a successful response", async () => {
    unsafeImpl = () => Promise.resolve([]);
    const res = await handleModTimeline(reqFor("https://x/api/history/mod-timeline"));
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(await res.json()).toEqual([]);
  });

  it("returns 503 when the DB throws", async () => {
    unsafeImpl = () => Promise.reject(new Error("connection refused"));
    const res = await handleModTimeline(reqFor("https://x/api/history/mod-timeline"));
    expect(res.status).toBe(503);
  });

  it("returns 503 when the DB throws on commit granularity too", async () => {
    unsafeImpl = () => Promise.reject(new Error("connection refused"));
    const res = await handleModTimeline(reqFor("https://x/api/history/mod-timeline?granularity=commit"));
    expect(res.status).toBe(503);
  });
});
