// Copies the registry's tables (copy-tables.ts) from a source database into this
// one. The source is only ever read, inside one REPEATABLE READ, READ ONLY
// transaction, so every table comes from the same snapshot and a stray write
// would fail there. Each table is written here in its own transaction, so a
// reader sees the old rows or the new ones, never a half-copied table.
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

async function copyOne(target: CopyDb, source: CopyDb, entry: CopyTable, log: (line: string) => void): Promise<string> {
  const cols = planColumns(entry, await columnsOf(source, entry.table), await columnsOf(target, entry.table));
  if (typeof cols === "string") {
    log(`pr-env copy: ${entry.table} skipped (${cols})`);
    return `${entry.table} skipped`;
  }
  const read = (await source.unsafe(`SELECT to_jsonb(t) AS row FROM (SELECT ${list(cols)} FROM ${q(entry.table)}) t`)) as { row: unknown }[];
  const rows = read.map((r) => r.row);
  await target.begin((tx) => writeRows(tx, entry, cols, rows));
  return `${entry.table} ${rows.length}`;
}

/** Copies every table, returning the summary line. A table that fails is reported and the rest carry on. */
export async function copyTables(target: CopyDb, source: CopyDb, tables: CopyTable[], log: (line: string) => void): Promise<string> {
  const parts: string[] = [];
  await source.begin(async (rx) => {
    await rx.unsafe("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    for (const entry of tables) {
      parts.push(await copyOne(target, rx, entry, log).catch((e: Error) => `${entry.table} failed (${e.message})`));
    }
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
