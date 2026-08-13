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

// Files sharing a numeric NNN_ prefix ARE allowed, but only these — see the
// lexical-compare comment in freshness.ts's deriveFreshnessStatus for why
// (full-filename lexical order is the real total order; the prefix alone
// doesn't disambiguate these pairs). Renaming any
// existing migration file is unsafe regardless: schema_migrations records
// applied migrations by filename (migrate.ts's `applied.has(file)`), so
// renaming a file already applied on some DB makes that DB re-run it at next
// boot. New files must pick the next free number instead.
const GRANDFATHERED_DUPLICATE_PREFIXES: Record<string, string[]> = {
  "014": ["014_collections.sql", "014_message_checks.sql"],
  "016": ["016_address_has_code.sql", "016_chat_titles.sql"],
};

describe("migrationFiles", () => {
  it("lists real .sql migration files, sorted ascending", () => {
    const files = migrationFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(f.endsWith(".sql")).toBe(true);
    const sorted = [...files].sort();
    expect(files).toEqual(sorted);
  });

  it("keeps numeric NNN_ prefixes non-decreasing in sorted order (lexical == numeric)", () => {
    // The full sort-ascending assertion above proves the LIST is lexically
    // ordered; it does not prove lexical order agrees with the NUMERIC
    // prefix order that REQUIRED_SCHEMA (freshness.ts, "last file wins")
    // actually depends on. A file like "9_foo.sql" sorts lexically after
    // "019_..." ("9" > "0") but is numerically earlier — this would silently
    // become the required schema. Zero-padded fixed-width prefixes are what
    // keep the two orders in agreement; assert that agreement directly. `<=`
    // (not `<`) because the grandfathered 014/014 and 016/016 pairs
    // legitimately repeat a prefix.
    const files = migrationFiles();
    const prefixes = files.map((f) => {
      const m = f.match(/^(\d+)_/);
      expect(m, `migration filename "${f}" doesn't start with a numeric NNN_ prefix`).not.toBeNull();
      return Number(m![1]);
    });
    for (let i = 1; i < prefixes.length; i++) {
      expect(
        prefixes[i],
        `migration prefix went backwards: ${files[i - 1]} (${prefixes[i - 1]}) sorts before ${files[i]} (${prefixes[i]})`,
      ).toBeGreaterThanOrEqual(prefixes[i - 1]);
    }
  });

  it("bans new duplicate numeric prefixes beyond the grandfathered 014/016 pairs", () => {
    // schema_migrations tracks applied migrations by filename, so an applied
    // file can never be renamed (see the module comment above) — the only
    // safe fix for a prefix collision is picking the next free number.
    const byPrefix = new Map<string, string[]>();
    for (const f of migrationFiles()) {
      const prefix = f.match(/^(\d+)_/)?.[1];
      if (prefix === undefined) continue; // covered by the previous test
      byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), f]);
    }
    const offenders: string[] = [];
    for (const [prefix, files] of byPrefix) {
      if (files.length <= 1) continue;
      const grandfathered = GRANDFATHERED_DUPLICATE_PREFIXES[prefix];
      const isExactMatch =
        grandfathered !== undefined &&
        files.length === grandfathered.length &&
        grandfathered.every((f) => files.includes(f));
      if (!isExactMatch) offenders.push(`${prefix}: ${files.join(", ")}`);
    }
    expect(
      offenders,
      `duplicate migration number prefix(es) found: ${offenders.join(
        "; ",
      )}. Pick the NEXT FREE number for the new migration instead of reusing one — ` +
        "renaming an existing migration file is unsafe because schema_migrations " +
        "records applied migrations by filename (migrate.ts's `applied.has(file)`), " +
        "so renaming a file already applied on some DB makes that DB re-run it at " +
        "next boot.",
    ).toEqual([]);
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
