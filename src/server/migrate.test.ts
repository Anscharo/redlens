// migrate.ts unit tests. Mocks ./db.ts COMPLETELY (sql: {reserve, begin}, plus
// every other named export the real module has — dbTarget, waitForDb,
// toVectorLiteral — as no-ops, mirroring auth.test.ts's convention) so no real
// Postgres connection is needed. Real migration *.sql files are read from disk
// (readFileSync is not mocked) but never executed against a real DB — the fake
// connections just record what they were asked to run.
import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

let queries: string[] = [];
let appliedIds: string[] = [];
let unsafeCalls: string[] = [];
let advisoryUnlockShouldThrow = false;
let released = false;

function makeConn() {
  const conn = (async (strings: TemplateStringsArray, ..._values: unknown[]) => {
    const text = strings.join("?");
    queries.push(text);
    if (text.includes("SELECT id FROM schema_migrations")) {
      return appliedIds.map((id) => ({ id }));
    }
    if (text.includes("pg_advisory_unlock") && advisoryUnlockShouldThrow) {
      throw new Error("unlock failed");
    }
    if (text.includes("INSERT INTO schema_migrations")) {
      // values[0] is the filename bound as a placeholder — bun tagged templates
      // pass it through `_values`, but we don't need it: the runner tracks
      // applied ids itself via `ran` before calling us again.
    }
    return [];
  }) as unknown as {
    (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
    unsafe: (ddl: string) => { simple: () => Promise<void> };
    release: () => void;
  };
  conn.unsafe = (ddl: string) => ({
    simple: async () => {
      unsafeCalls.push(ddl);
    },
  });
  conn.release = () => {
    released = true;
  };
  return conn;
}

mock.module("./db.ts", () => ({
  sql: {
    reserve: async () => makeConn(),
    begin: async (cb: (tx: unknown) => Promise<void>) => {
      const tx = makeConn();
      return await cb(tx);
    },
  },
  dbTarget: () => "mock-db",
  waitForDb: () => Promise.resolve(),
  toVectorLiteral: (vec: number[]) => `[${vec.join(",")}]`,
}));

const { migrationFiles, runMigrations } = await import("./migrate.ts");

afterAll(() => {
  mock.restore();
});

beforeEach(() => {
  queries = [];
  appliedIds = [];
  unsafeCalls = [];
  advisoryUnlockShouldThrow = false;
  released = false;
});

describe("migrationFiles", () => {
  it("lists real .sql migration files, sorted ascending", () => {
    const files = migrationFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(f.endsWith(".sql")).toBe(true);
    const sorted = [...files].sort();
    expect(files).toEqual(sorted);
  });
});

describe("runMigrations", () => {
  it("no-ops when every migration is already recorded applied", async () => {
    appliedIds = migrationFiles();
    const ran = await runMigrations();
    expect(ran).toEqual([]);
    expect(unsafeCalls.length).toBe(0); // no DDL executed
    expect(released).toBe(true); // connection always released
  });

  it("runs pending migrations (transactional path) and records each", async () => {
    const all = migrationFiles();
    appliedIds = all.slice(0, -1); // every file but the last is already applied
    const ran = await runMigrations();
    expect(ran).toEqual([all[all.length - 1]]);
    // The pending file's DDL was executed via sql.begin()'s tx.unsafe(...).simple().
    expect(unsafeCalls.length).toBe(1);
    expect(released).toBe(true);
  });

  it("runs ALL migrations when none are recorded applied", async () => {
    appliedIds = [];
    const ran = await runMigrations();
    const all = migrationFiles();
    expect(ran).toEqual(all);
    expect(unsafeCalls.length).toBe(all.length);
  });

  it("still releases the reserved connection when the advisory unlock fails", async () => {
    appliedIds = migrationFiles();
    advisoryUnlockShouldThrow = true;
    // Should not throw — the unlock failure is caught + logged, not propagated.
    const ran = await runMigrations();
    expect(ran).toEqual([]);
    expect(released).toBe(true);
  });
});
