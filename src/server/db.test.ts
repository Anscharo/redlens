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

test("waitForDb gives up and throws after exhausting attempts against an unreachable db", async () => {
  const { waitForDb } = await freshDb();
  // db.ts's `sql` is bound to config.databaseUrl at import time (the docker
  // default, localhost:5432) — no Postgres listens there in this environment,
  // so the connection fails immediately (ECONNREFUSED), no real network hang.
  await expect(waitForDb(1)).rejects.toBeTruthy();
});

test("waitForDb retries with backoff before giving up (attempts > 1)", async () => {
  const { waitForDb } = await freshDb();
  const start = Date.now();
  await expect(waitForDb(2)).rejects.toBeTruthy();
  // One retry sleeps ~500ms between attempts.
  expect(Date.now() - start).toBeGreaterThanOrEqual(400);
});
