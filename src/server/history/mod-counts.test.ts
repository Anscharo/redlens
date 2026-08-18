// Run under `bun test` (NOT vitest) — imports Bun SQL transitively via ../db.ts.
//
// DB MOCKING SHAPE — see history.test.ts's header for the full write-up. The
// short version: bun's `mock.module` patches the module registry for the REST
// OF THE PROCESS, and `mock.restore()` does NOT undo it. This file used to call
// `mock.module("../db.ts", …)` from inside four `it()` bodies, each supplying
// ONLY `sql` — so the moment this file had run, db.ts had permanently lost
// `toVectorLiteral`/`dbTarget`/`waitForDb`, and the next file to import one of
// those died at link time ("Export named 'toVectorLiteral' not found in module
// …/db.ts"). That is a module-link error, not an assertion, so it takes out a
// whole file. `bun test` walks files in readdir order (and reorders explicit
// CLI args), so which file got hit varied by machine and by checkout.
//
// There is now exactly ONE module-scope registration, spreading the eagerly
// snapshotted real namespace so no export is ever dropped. mod-counts.ts calls
// `sql.unsafe(…)` rather than the tagged-template form, so what swaps here is
// `unsafeImpl` (armed per case, disarmed in beforeEach/afterEach); disarmed,
// `.unsafe` forwards to the real client, which makes the registration a
// behavioural no-op for every file scheduled after this one.
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

const { handleModCounts } = await import("./mod-counts.ts");

const VALID_UUID = "d0d77316-0b08-447c-b75a-ae7926b07019";
const VALID_UUID_2 = "f8225872-d517-40f1-a931-241b5d0cc07b";

describe("handleModCounts", () => {
  // Disarm on both edges so no case leaks its impl into a sibling — or, once
  // this file finishes, into another test file.
  beforeEach(() => {
    unsafeImpl = null;
  });
  afterEach(() => {
    unsafeImpl = null;
  });

  it("maps rows to the client ModCount shape and normalises dates", async () => {
    unsafeImpl = () =>
      Promise.resolve([
        {
          doc_id: VALID_UUID,
          semantic_count: 3,
          last_semantic_at: new Date("2026-05-20T10:09:52-07:00"),
          content_count: 7,
        },
        {
          doc_id: VALID_UUID_2,
          semantic_count: 0,
          last_semantic_at: null,
          content_count: 2,
        },
      ]);
    const res = await handleModCounts();
    expect(res.status).toBe(200);
    const body = (await res.json()) as any[];
    expect(body).toEqual([
      { docId: VALID_UUID, count: 3, lastModified: "2026-05-20", contentCount: 7 },
      { docId: VALID_UUID_2, count: 0, lastModified: null, contentCount: 2 },
    ]);
  });

  it("normalises an ISO-string last_semantic_at to YYYY-MM-DD", async () => {
    unsafeImpl = () =>
      Promise.resolve([
        { doc_id: VALID_UUID, semantic_count: 1, last_semantic_at: "2025-11-21T00:00:00.000Z", content_count: 1 },
      ]);
    const body = (await (await handleModCounts()).json()) as any[];
    expect(body[0].lastModified).toBe("2025-11-21");
  });

  it("sets Cache-Control on a successful response", async () => {
    unsafeImpl = () => Promise.resolve([]);
    const res = await handleModCounts();
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(await res.json()).toEqual([]);
  });

  it("returns 503 when the DB throws", async () => {
    unsafeImpl = () => Promise.reject(new Error("connection refused"));
    const res = await handleModCounts();
    expect(res.status).toBe(503);
  });
});
