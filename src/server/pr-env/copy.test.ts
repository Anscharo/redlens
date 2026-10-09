// The copy against an in-memory fake that understands exactly the statements
// copy.ts issues. Real-Postgres behaviour (jsonb stays an object, timestamptz
// keeps its microseconds, the READ ONLY transaction refuses a write) is not
// covered here; see the verification recipe in src/server/pau/CLAUDE.md.
import { describe, expect, test } from "bun:test";
import { copyFromSource, copyTables, pendingTables, planColumns, type CopyDb } from "./copy.ts";
import type { CopyTable } from "./copy-tables.ts";

type Row = Record<string, unknown>;
type Tables = Record<string, { cols: string[]; rows: Row[] }>;

function fakeDb(tables: Tables, journal: string[] = [], opts: { writable?: string[]; unreadable?: string } = {}): CopyDb {
  const named = (query: string, re: RegExp) => tables[re.exec(query)![1]!]!;
  const db: CopyDb = {
    async unsafe(query, params = []) {
      journal.push(query);
      if (query.includes("SELECT EXISTS")) {
        const t = named(query, /FROM "(\w+)"/);
        const cols = [...query.matchAll(/"(\w+)" IS NOT NULL/g)].map((m) => m[1]!);
        return [{ any: t.rows.some((r) => !cols.length || cols.some((c) => r[c] != null)) }];
      }
      if (query.includes("has_table_privilege")) return (opts.writable ?? []).map((name) => ({ name }));
      if (opts.unreadable && query.startsWith("SELECT to_jsonb") && query.includes(`"${opts.unreadable}"`)) throw new Error("permission denied");
      if (query.includes("information_schema")) return (tables[params[0] as string]?.cols ?? []).map((name) => ({ name }));
      if (query.startsWith("SET TRANSACTION")) return [];
      if (query.startsWith("SELECT to_jsonb")) {
        const cols = [...query.matchAll(/"(\w+)"/g)].map((m) => m[1]!).slice(0, -1);
        return named(query, /FROM "(\w+)"\) t$/).rows.map((r) => ({ row: Object.fromEntries(cols.map((c) => [c, r[c]])) }));
      }
      if (query.startsWith("DELETE")) named(query, /^DELETE FROM "(\w+)"/).rows = [];
      if (query.startsWith("INSERT")) named(query, /^INSERT INTO "(\w+)"/).rows.push(...(params[0] as Row[]));
      if (query.startsWith("UPDATE")) merge(named(query, /^UPDATE "(\w+)"/).rows, query, params[0] as Row[]);
      return [];
    },
    begin: (fn) => fn(db),
  };
  return db;
}

function merge(rows: Row[], query: string, incoming: Row[]) {
  const keys = [...query.matchAll(/d\."(\w+)"/g)].map((m) => m[1]!);
  const cols = [...query.split(" FROM ")[0]!.matchAll(/"(\w+)" = s\./g)].map((m) => m[1]!);
  for (const s of incoming) {
    const row = rows.find((r) => keys.every((k) => r[k] === s[k]));
    if (row) for (const c of cols) row[c] = s[c];
  }
}

const EVENTS = ["chain", "tx_hash", "args"];
const quiet = () => {};

describe("copyTables", () => {
  test("replaces the target's rows wholesale with the source's", async () => {
    const src = fakeDb({ pau_events: { cols: EVENTS, rows: [{ chain: "ethereum", tx_hash: "0x1", args: { a: 1 } }] } });
    const dst: Tables = { pau_events: { cols: EVENTS, rows: [{ chain: "ethereum", tx_hash: "0xstale", args: {} }] } };
    const line = await copyTables(fakeDb(dst), src, [{ table: "pau_events" }], quiet);
    expect(dst.pau_events!.rows).toEqual([{ chain: "ethereum", tx_hash: "0x1", args: { a: 1 } }]);
    expect(line).toBe("pr-env copy from the source database — pau_events 1");
  });

  test("a merge entry overwrites only its columns on matching rows and keeps this environment's rows", async () => {
    const cols = ["address", "chain", "label", "balances"];
    const entry: CopyTable = { table: "atlas_addresses", merge: { key: ["address", "chain"], columns: ["balances"] } };
    const src = fakeDb({ atlas_addresses: { cols, rows: [{ address: "0xa", chain: "base", label: "dev", balances: { ETH: 1 } }, { address: "0xz", chain: "base", balances: {} }] } });
    const dst: Tables = { atlas_addresses: { cols, rows: [{ address: "0xa", chain: "base", label: "mine", balances: null }, { address: "0xb", chain: "base", label: "own", balances: null }] } };
    await copyTables(fakeDb(dst), src, [entry], quiet);
    expect(dst.atlas_addresses!.rows).toEqual([
      { address: "0xa", chain: "base", label: "mine", balances: { ETH: 1 } },
      { address: "0xb", chain: "base", label: "own", balances: null },
    ]);
  });

  test("skips a table missing on either side with a log line and copies the rest", async () => {
    const log: string[] = [];
    const src = fakeDb({ pau_events: { cols: EVENTS, rows: [] }, pau_state: { cols: ["deployment"], rows: [{ deployment: "d" }] } });
    const dst: Tables = { pau_state: { cols: ["deployment"], rows: [] }, spell_casts: { cols: ["id"], rows: [] } };
    const tables = [{ table: "pau_events" }, { table: "spell_casts" }, { table: "pau_state" }];
    const line = await copyTables(fakeDb(dst), src, tables, (l) => log.push(l));
    expect(log).toEqual(["pr-env copy: pau_events skipped (missing here)", "pr-env copy: spell_casts skipped (missing on the source)"]);
    expect(dst.pau_state!.rows).toEqual([{ deployment: "d" }]);
    expect(line).toBe("pr-env copy from the source database — pau_events skipped, spell_casts skipped, pau_state 1");
  });

  test("never writes to the source: a READ ONLY transaction first, then reads and savepoints only", async () => {
    const journal: string[] = [];
    const src = fakeDb({ pau_events: { cols: EVENTS, rows: [{ chain: "e", tx_hash: "0x1", args: {} }] } }, journal);
    await copyTables(fakeDb({ pau_events: { cols: EVENTS, rows: [] } }), src, [{ table: "pau_events" }], quiet);
    expect(journal[0]).toBe("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    for (const q of journal.slice(1)) expect(q).toMatch(/^(SELECT|SAVEPOINT|RELEASE SAVEPOINT)/);
  });

  test("refuses a source login that can write a copied table, and copies nothing", async () => {
    const src = fakeDb({ pau_events: { cols: EVENTS, rows: [{ chain: "e", tx_hash: "0x1", args: {} }] } }, [], { writable: ["pau_events"] });
    const dst: Tables = { pau_events: { cols: EVENTS, rows: [{ chain: "e", tx_hash: "0xkeep", args: {} }] } };
    await expect(copyTables(fakeDb(dst), src, [{ table: "pau_events" }], quiet)).rejects.toThrow("its login can write to pau_events; use a read-only role");
    expect(dst.pau_events!.rows).toEqual([{ chain: "e", tx_hash: "0xkeep", args: {} }]);
  });

  test("an empty source table keeps this environment's rows", async () => {
    const log: string[] = [];
    const dst: Tables = { pau_events: { cols: EVENTS, rows: [{ chain: "e", tx_hash: "0xkeep", args: {} }] } };
    const line = await copyTables(fakeDb(dst), fakeDb({ pau_events: { cols: EVENTS, rows: [] } }), [{ table: "pau_events" }], (l) => log.push(l));
    expect(dst.pau_events!.rows).toEqual([{ chain: "e", tx_hash: "0xkeep", args: {} }]);
    expect(log).toEqual(["pr-env copy: pau_events skipped (empty on the source; keeping the rows here)"]);
    expect(line).toBe("pr-env copy from the source database — pau_events skipped");
  });

  test("a table that fails to read rolls back to its savepoint and the rest carry on", async () => {
    const journal: string[] = [];
    const src = fakeDb({ a: { cols: ["x"], rows: [{ x: 1 }] }, b: { cols: ["x"], rows: [{ x: 2 }] } }, journal, { unreadable: "a" });
    const dstTables: Tables = { a: { cols: ["x"], rows: [] }, b: { cols: ["x"], rows: [] } };
    const line = await copyTables(fakeDb(dstTables), src, [{ table: "a" }, { table: "b" }], quiet);
    expect(line).toBe("pr-env copy from the source database — a failed (permission denied), b 1");
    expect(journal).toContain("ROLLBACK TO SAVEPOINT pr_env_copy");
    expect(dstTables.b!.rows).toEqual([{ x: 2 }]);
  });

  test("a table whose write fails is reported and the rest carry on", async () => {
    const src = fakeDb({ a: { cols: ["x"], rows: [{ x: 1 }] }, b: { cols: ["x"], rows: [{ x: 2 }] } });
    const dstTables: Tables = { a: { cols: ["x"], rows: [] }, b: { cols: ["x"], rows: [] } };
    const dst = fakeDb(dstTables);
    let begins = 0;
    const failing: CopyDb = { ...dst, begin: (fn) => (begins++ === 0 ? Promise.reject(new Error("disk full")) : fn(dst)) };
    const line = await copyTables(failing, src, [{ table: "a" }, { table: "b" }], quiet);
    expect(line).toBe("pr-env copy from the source database — a failed (disk full), b 1");
    expect(dstTables.b!.rows).toEqual([{ x: 2 }]);
  });
});

describe("pendingTables", () => {
  test("a table is pending while this environment holds none of its data, or lacks the table", async () => {
    const merge: CopyTable = { table: "atlas_addresses", merge: { key: ["address"], columns: ["balances"] } };
    const db = fakeDb({
      pau_events: { cols: EVENTS, rows: [{ chain: "e", tx_hash: "0x1", args: {} }] },
      pau_state: { cols: ["deployment"], rows: [] },
      atlas_addresses: { cols: ["address", "balances"], rows: [{ address: "0xa", balances: null }] },
    });
    const pending = await pendingTables(db, [{ table: "pau_events" }, { table: "pau_state" }, merge, { table: "spell_casts" }]);
    expect(pending.map((t) => t.table)).toEqual(["pau_state", "atlas_addresses", "spell_casts"]);
  });

  test("a merge entry is seeded once any row has one of its columns set", async () => {
    const merge: CopyTable = { table: "atlas_addresses", merge: { key: ["address"], columns: ["balances", "has_code"] } };
    const db = fakeDb({ atlas_addresses: { cols: ["address", "balances", "has_code"], rows: [{ address: "0xa", balances: null, has_code: true }] } });
    expect(await pendingTables(db, [merge])).toEqual([]);
  });

  test("a merge entry whose columns this environment lacks is pending, not an error", async () => {
    const merge: CopyTable = { table: "atlas_addresses", merge: { key: ["address"], columns: ["balances", "has_code"] } };
    const db = fakeDb({ atlas_addresses: { cols: ["address", "balances"], rows: [{ address: "0xa", balances: { ETH: 1 } }] } });
    expect(await pendingTables(db, [merge])).toEqual([merge]);
  });
});

describe("planColumns", () => {
  test("a replaced table carries the columns both sides have", () => {
    expect(planColumns({ table: "t" }, ["a", "b", "new"], ["a", "b", "local"])).toEqual(["a", "b"]);
  });

  test("a merge needs every key and column on both sides", () => {
    const entry: CopyTable = { table: "t", merge: { key: ["k"], columns: ["v", "w"] } };
    expect(planColumns(entry, ["k", "v", "w"], ["k", "v", "w", "x"])).toEqual(["k", "v", "w"]);
    expect(planColumns(entry, ["k", "v"], ["k", "v", "w"])).toBe("columns missing: w");
  });
});

describe("copyFromSource", () => {
  test("an unreachable source throws and leaves the target untouched", async () => {
    const journal: string[] = [];
    const dst: Tables = { pau_events: { cols: EVENTS, rows: [{ chain: "e", tx_hash: "0xkeep", args: {} }] } };
    const url = "postgres://nobody:nothing@127.0.0.1:1/none";
    await expect(copyFromSource(fakeDb(dst, journal), url, [{ table: "pau_events" }], quiet)).rejects.toThrow("source database: ");
    expect(journal).toEqual([]);
    expect(dst.pau_events!.rows).toEqual([{ chain: "e", tx_hash: "0xkeep", args: {} }]);
  });
});
