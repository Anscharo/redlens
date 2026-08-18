// Real db.ts unit tests. auth.test.ts / mcp.test.ts / our own migrate.test.ts
// and collections.test.ts register mock.module("./db.ts", ...) — bun's module
// mocks are global for the rest of the process, so a plain `import "./db.ts"`
// here could resolve to someone else's stub depending on file load order.
// A cache-busting query string (`?realdb=N`) is a distinct specifier bun
// resolves fresh, bypassing any registered mock — see config.test.ts for the
// same trick. No Postgres is running in this environment (confirmed via nc),
// so waitForDb's connect attempts fail fast/deterministically; only its
// failure path is exercised here (the success early-return needs a real DB).
import { test, expect } from "bun:test";

let counter = 0;
async function freshDb() {
  counter++;
  return await import(`./db.ts?realdb=${counter}`);
}

// db.ts's `dbTarget`/`sql` close over config.ts's canonical (plain-specifier,
// non-cache-busted) module instance — the same one every other file in this
// run shares — so mutating databaseUrl there is what actually affects them.
test("dbTarget strips credentials, keeping host:port/path", async () => {
  const { dbTarget } = await freshDb();
  const { config } = await import("./config.ts");
  const orig = config.databaseUrl;
  try {
    config.databaseUrl = "postgres://user:hunter2@dbhost:6543/mydb";
    expect(dbTarget()).toBe("dbhost:6543/mydb");

    config.databaseUrl = "postgres://user:hunter2@dbhost/mydb"; // no port → default 5432
    expect(dbTarget()).toBe("dbhost:5432/mydb");
  } finally {
    config.databaseUrl = orig;
  }
});

test("dbTarget returns a fallback string for an unparseable DATABASE_URL", async () => {
  const { dbTarget } = await freshDb();
  const { config } = await import("./config.ts");
  const orig = config.databaseUrl;
  try {
    config.databaseUrl = "not a url";
    expect(dbTarget()).toBe("(unparseable DATABASE_URL)");
  } finally {
    config.databaseUrl = orig;
  }
});

test("toVectorLiteral formats a number[] as a pgvector bracket literal", async () => {
  const { toVectorLiteral } = await freshDb();
  expect(toVectorLiteral([0.1, 0.2, 0.3])).toBe("[0.1,0.2,0.3]");
  expect(toVectorLiteral([])).toBe("[]");
  expect(toVectorLiteral([1])).toBe("[1]");
});

test("fromUuidArray accepts a JS array, a Postgres text literal, and empty/null", async () => {
  const { fromUuidArray } = await freshDb();
  const a = "575ab954-d26c-460e-8a11-ebe7f5586dff";
  const b = "9a8120c4-0a5b-426f-97a5-283c708413f5";
  expect(fromUuidArray([a, b])).toEqual([a, b]);
  expect(fromUuidArray(`{${a},${b}}`)).toEqual([a, b]);
  expect(fromUuidArray(`{${a}}`)).toEqual([a]);
  expect(fromUuidArray("{}")).toEqual([]);
  expect(fromUuidArray("")).toEqual([]);
  expect(fromUuidArray(null)).toEqual([]);
  expect(fromUuidArray(undefined)).toEqual([]);
  expect(fromUuidArray(a)).toEqual([a]);
});

test("toUuidArrayLiteral formats a uuid[] as a Postgres brace literal", async () => {
  // A STRING, never a JS array: Bun.sql sends a bound JS array's first element as a
  // scalar, which Postgres rejects with `malformed array literal`. That was the real
  // boot-embeddings failure on atlas_doc_embeddings.member_ids.
  const { toUuidArrayLiteral } = await freshDb();
  const a = "575ab954-d26c-460e-8a11-ebe7f5586dff";
  const b = "9a8120c4-0a5b-426f-97a5-283c708413f5";
  expect(toUuidArrayLiteral([a])).toBe(`{${a}}`);
  expect(toUuidArrayLiteral([a, b])).toBe(`{${a},${b}}`);
  expect(toUuidArrayLiteral([])).toBe("{}");
  expect(typeof toUuidArrayLiteral([a])).toBe("string");
});

// Point db.ts's `sql` at a guaranteed-unreachable target BEFORE importing it, so
// waitForDb can never connect — independent of whether a real Postgres is
// reachable in this environment. The CI "Railway server" job runs this same
// suite WITH a live localhost:5432, so the old "docker default is unreachable"
// assumption failed there; 127.0.0.1:1 refuses immediately everywhere.
const UNREACHABLE_DB = "postgres://redlens:redlens@127.0.0.1:1/redlens"; // nothing listens on :1

test("waitForDb gives up and throws after exhausting attempts against an unreachable db", async () => {
  const { config } = await import("./config.ts");
  const orig = config.databaseUrl;
  config.databaseUrl = UNREACHABLE_DB;
  try {
    const { waitForDb } = await freshDb(); // fresh `sql` binds to the unreachable URL
    const slept: number[] = [];
    await expect(waitForDb(1, async (ms: number) => void slept.push(ms))).rejects.toBeTruthy();
    // The last attempt throws instead of sleeping — no backoff after giving up.
    expect(slept).toEqual([]);
  } finally {
    config.databaseUrl = orig;
  }
});

// Asserts the retry BEHAVIOUR (a second connect attempt, preceded by one
// backoff sleep) via waitForDb's injectable sleep, not the wall clock: a
// Date.now() delta would both burn the real backoff and break whenever the
// base/cap constants in db.ts are tuned.
test("waitForDb retries with backoff before giving up (attempts > 1)", async () => {
  const { config } = await import("./config.ts");
  const orig = config.databaseUrl;
  config.databaseUrl = UNREACHABLE_DB;
  const warnings: string[] = [];
  const realWarn = console.warn;
  console.warn = (...args: unknown[]) => void warnings.push(args.join(" "));
  try {
    const { waitForDb } = await freshDb();
    const slept: number[] = [];
    await expect(waitForDb(3, async (ms: number) => void slept.push(ms))).rejects.toBeTruthy();
    // attempts-1 sleeps, doubling from the base delay — the schedule itself,
    // whatever the constants are.
    expect(slept).toHaveLength(2);
    expect(slept[1]).toBe(slept[0] * 2);
    // Every retry announces itself, so a stuck boot is diagnosable from logs.
    expect(warnings.filter((w) => w.includes("not ready"))).toHaveLength(2);
    expect(warnings[0]).toContain(`retrying in ${slept[0]}ms`);
  } finally {
    console.warn = realWarn;
    config.databaseUrl = orig;
  }
});
