// Copies the registry's tables (copy-tables.ts) from a source database into this
// one, once: a table is copied only while this environment holds none of its
// data (no rows; for a merge entry, no row with its columns set), so a PR
// environment is seeded when it is created and every later tick finds nothing
// to do without opening the source. Emptying a table here copies it again. The source is only ever read, inside one REPEATABLE READ, READ ONLY
// transaction, so every table comes from the same snapshot and a stray write
// would fail there. That guard is this code's own, and a PR environment runs
// the PR's code with the source URL in its environment, so the copy also
// refuses a source login that could write any copied table: only a read-only
// role keeps a PR from writing to the development database. Each table is
// read under its own savepoint, so one that fails to read leaves the rest
// readable, and written here in its own transaction, so a reader sees the old
// rows or the new ones, never a half-copied table.
//
// Rows travel as jsonb built by Postgres (`to_jsonb`) and are unpacked by
// Postgres (`jsonb_populate_recordset` against this table's row type), so a
// jsonb column arrives as an object, never a string, and timestamptz keeps its
// microseconds. The rows pass through JS as parsed JSON, so a number column
// must stay within 2^53; block numbers do, and PAU stores bigints as text.
import { SQL } from "bun";
import type { CopyTable } from "./copy-tables.ts";

/** The slice of Bun.sql the copy uses; a test passes a fake. */
export interface CopyDb {
  unsafe(query: string, params?: unknown[]): Promise<unknown[]>;
  begin<T>(fn: (tx: CopyDb) => Promise<T>): Promise<T>;
}

const CHUNK = 1000;
const q = (name: string) => `"${name.replaceAll('"', '""')}"`;
const list = (cols: string[]) => cols.map(q).join(", ");

async function columnsOf(db: CopyDb, table: string): Promise<string[]> {
  const rows = (await db.unsafe(
    "SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 ORDER BY ordinal_position",
    [table],
  )) as { name: string }[];
  return rows.map((r) => r.name);
}

/**
 * The columns to carry, or the reason the table is skipped. A replaced table
 * carries the columns both sides have, so a migration one side lacks leaves the
 * others to their defaults; a merge needs every key and column on both sides.
 */
export function planColumns(entry: CopyTable, src: string[], dst: string[]): string[] | string {
  if (!src.length) return "missing on the source";
  if (!dst.length) return "missing here";
  if (!entry.merge) return src.filter((c) => dst.includes(c));
  const wanted = [...entry.merge.key, ...entry.merge.columns];
  const absent = wanted.filter((c) => !src.includes(c) || !dst.includes(c));
  return absent.length ? `columns missing: ${absent.join(", ")}` : wanted;
}

function writeSql(entry: CopyTable, cols: string[]): string {
  const rows = `jsonb_populate_recordset(NULL::${q(entry.table)}, $1::jsonb)`;
  if (!entry.merge) return `INSERT INTO ${q(entry.table)} (${list(cols)}) SELECT ${list(cols)} FROM ${rows}`;
  const set = entry.merge.columns.map((c) => `${q(c)} = s.${q(c)}`).join(", ");
  const on = entry.merge.key.map((k) => `d.${q(k)} = s.${q(k)}`).join(" AND ");
  return `UPDATE ${q(entry.table)} AS d SET ${set} FROM ${rows} AS s WHERE ${on}`;
}

async function writeRows(tx: CopyDb, entry: CopyTable, cols: string[], rows: unknown[]): Promise<void> {
  if (!entry.merge) await tx.unsafe(`DELETE FROM ${q(entry.table)}`);
  const stmt = writeSql(entry, cols);
  for (let i = 0; i < rows.length; i += CHUNK) await tx.unsafe(stmt, [rows.slice(i, i + CHUNK)]);
}

function skip(log: (line: string) => void, table: string, why: string): string {
  log(`pr-env copy: ${table} skipped (${why})`);
  return `${table} skipped`;
}

/** An empty source table is skipped rather than copied, so a truncated or half-migrated source never blanks this environment's rows. */
async function copyOne(target: CopyDb, source: CopyDb, entry: CopyTable, log: (line: string) => void): Promise<string> {
  const cols = planColumns(entry, await columnsOf(source, entry.table), await columnsOf(target, entry.table));
  if (typeof cols === "string") return skip(log, entry.table, cols);
  const read = (await source.unsafe(`SELECT to_jsonb(t) AS row FROM (SELECT ${list(cols)} FROM ${q(entry.table)}) t`)) as { row: unknown }[];
  if (!read.length) return skip(log, entry.table, "empty on the source; keeping the rows here");
  const rows = read.map((r) => r.row);
  await target.begin((tx) => writeRows(tx, entry, cols, rows));
  return `${entry.table} ${rows.length}`;
}

/** The copied tables the source login could write to; the copy runs only when there are none. */
async function writableTables(rx: CopyDb, tables: CopyTable[]): Promise<string[]> {
  const names = `{${tables.map((t) => t.table).join(",")}}`;
  const rows = (await rx.unsafe(
    "SELECT t AS name FROM unnest($1::text[]) AS t WHERE to_regclass(t) IS NOT NULL AND has_table_privilege(to_regclass(t), 'INSERT, UPDATE, DELETE, TRUNCATE')",
    [names],
  )) as { name: string }[];
  return rows.map((r) => r.name);
}

/** One table's read under its own savepoint, so a failed read does not abort the snapshot for the tables after it. */
async function copyIsolated(target: CopyDb, rx: CopyDb, entry: CopyTable, log: (line: string) => void): Promise<string> {
  await rx.unsafe("SAVEPOINT pr_env_copy");
  try {
    const part = await copyOne(target, rx, entry, log);
    await rx.unsafe("RELEASE SAVEPOINT pr_env_copy");
    return part;
  } catch (e) {
    await rx.unsafe("ROLLBACK TO SAVEPOINT pr_env_copy");
    return `${entry.table} failed (${(e as Error).message})`;
  }
}

/** Whether this environment already holds the table's data; a table or merge column missing here is not seeded yet. */
async function seeded(target: CopyDb, entry: CopyTable): Promise<boolean> {
  const have = await columnsOf(target, entry.table);
  if (!have.length || entry.merge?.columns.some((c) => !have.includes(c))) return false;
  const filled = entry.merge ? ` WHERE ${entry.merge.columns.map((c) => `${q(c)} IS NOT NULL`).join(" OR ")}` : "";
  const [r] = (await target.unsafe(`SELECT EXISTS (SELECT 1 FROM ${q(entry.table)}${filled}) AS any`)) as { any: boolean }[];
  return Boolean(r?.any);
}

/** The tables this environment has not been seeded with yet. */
export async function pendingTables(target: CopyDb, tables: CopyTable[]): Promise<CopyTable[]> {
  const pending: CopyTable[] = [];
  for (const entry of tables) if (!(await seeded(target, entry))) pending.push(entry);
  return pending;
}

/** Copies every table, returning the summary line. A table that fails is reported and the rest carry on. Throws when the source login can write. */
export async function copyTables(target: CopyDb, source: CopyDb, tables: CopyTable[], log: (line: string) => void): Promise<string> {
  const parts: string[] = [];
  await source.begin(async (rx) => {
    await rx.unsafe("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    const writable = await writableTables(rx, tables);
    if (writable.length) throw new Error(`its login can write to ${writable.join(", ")}; use a read-only role (scripts/CLAUDE.md, "PR environments")`);
    for (const entry of tables) parts.push(await copyIsolated(target, rx, entry, log));
  });
  return `pr-env copy from the source database — ${parts.join(", ")}`;
}

/** Opens the source at `url`, copies, and closes it. Throws when the source is unreachable. */
export async function copyFromSource(target: CopyDb, url: string, tables: CopyTable[], log: (line: string) => void): Promise<string> {
  const source = new SQL(url, { max: 1, connectionTimeout: 15, idleTimeout: 5 });
  try {
    return await copyTables(target, source as unknown as CopyDb, tables, log);
  } catch (e) {
    throw new Error(`source database: ${(e as Error).message} — keeping the rows this environment has`, { cause: e });
  } finally {
    await source.close();
  }
}
