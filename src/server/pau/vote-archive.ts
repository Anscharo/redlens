// Executive votes older than the vote record, read from the makerdao/community
// repository (governance/votes) a few files per worker tick into
// executive_archive. A title is stored only when the file's spell address is a
// cast spell (casts.ts) cast on or after the vote's date. A spell with no
// recorded cast is rejected only when its own contract says it never will be
// (done() false and expiration() past; vote-archive-parse.ts); otherwise the
// file stays pending and is checked again.
// Nothing here touches votes.json: the PAU history joins the archive at read
// time (history.ts), after the vote record.
import type { SqlTag } from "../sql-types.ts";
import { readFrontmatterFields, verdictFor, type ArchiveVerdict, type SpellState } from "./vote-archive-parse.ts";

export const ARCHIVE_BLOB = "https://github.com/makerdao/community/blob/master/governance/votes/";
const RAW = "https://raw.githubusercontent.com/makerdao/community/master/governance/votes/";
const LIST = "https://api.github.com/repos/makerdao/community/contents/governance/votes?ref=master";

export interface ArchiveDeps {
  fetchText: (url: string) => Promise<string>;
  fetchJson: (url: string) => Promise<unknown>;
  /** The spell contract's own done() and expiration(), read on Ethereum. */
  spellState: (spell: string) => Promise<SpellState>;
  now?: () => number;
}

/** Lists the repository's executive files once, as pending rows, in one statement so a failed run leaves none; a later run never relists. */
async function seed(db: SqlTag, deps: ArchiveDeps): Promise<number> {
  const rows = (await db`SELECT count(*)::int AS n FROM executive_archive`) as { n: number }[];
  if (rows[0]?.n) return 0;
  const listing = await deps.fetchJson(LIST);
  if (!Array.isArray(listing)) throw new Error("executive archive: the listing is not an array");
  const files = listing.map((f) => String((f as { name?: unknown }).name ?? "")).filter((n) => /^executive vote.*\.md$/i.test(n));
  if (files.length < 100) throw new Error(`executive archive: listing names ${files.length} executive files, expected 100 or more`);
  await db`INSERT INTO executive_archive (file, status) SELECT f, 'pending' FROM jsonb_array_elements_text(${files}::jsonb) AS f ON CONFLICT DO NOTHING`;
  return files.length;
}

/** The spell's earliest recorded DSPause cast (ISO), null when the cast list holds none. */
async function firstCast(db: SqlTag, spell: string): Promise<string | null> {
  const [c] = (await db`SELECT min(block_time) AS first FROM spell_casts WHERE spell = ${spell}`) as { first: Date | string | null }[];
  return c?.first ? new Date(c.first).toISOString() : null;
}

async function check(db: SqlTag, deps: ArchiveDeps, file: string, now: number): Promise<ArchiveVerdict> {
  const fields = readFrontmatterFields(await deps.fetchText(RAW + encodeURIComponent(file)));
  if (!fields.spell) return verdictFor(fields, null, { done: null, expiration: null }, now);
  const first = await firstCast(db, fields.spell);
  return verdictFor(fields, first, first ? { done: true, expiration: null } : await deps.spellState(fields.spell), now);
}

async function record(db: SqlTag, file: string, v: ArchiveVerdict, at: Date): Promise<void> {
  const title = v.status === "verified" ? v.title : null;
  await db`
    UPDATE executive_archive SET status = ${v.status}, spell = ${v.spell}, title = ${title}, date = ${v.date}, reason = ${v.reason}, checked_at = ${at}
    WHERE file = ${file}`;
}

export interface ArchiveRun {
  listed: number;
  checked: number;
  verified: number;
  pending: number;
}

async function checkOne(db: SqlTag, deps: ArchiveDeps, file: string, at: Date): Promise<ArchiveVerdict> {
  let v: ArchiveVerdict;
  try {
    v = await check(db, deps, file, at.getTime());
  } catch (e) {
    v = { status: "pending", spell: null, title: null, date: null, reason: String((e as Error).message ?? e).slice(0, 200) };
  }
  await record(db, file, v, at);
  return v;
}

/** Lists the files once, then checks up to `files` pending ones not checked within a day. A failed fetch keeps its file pending. */
export async function backfillArchive(db: SqlTag, deps: ArchiveDeps, files: number): Promise<ArchiveRun> {
  const now = new Date((deps.now ?? Date.now)());
  const run: ArchiveRun = { listed: await seed(db, deps), checked: 0, verified: 0, pending: 0 };
  const due = (await db`
    SELECT file FROM executive_archive WHERE status = 'pending' AND (checked_at IS NULL OR checked_at < ${new Date(now.getTime() - 86_400_000)})
    ORDER BY file LIMIT ${files}`) as { file: string }[];
  for (const { file } of due) {
    run.checked++;
    if ((await checkOne(db, deps, file, now)).status === "verified") run.verified++;
  }
  const [left] = (await db`SELECT count(*)::int AS n FROM executive_archive WHERE status = 'pending'`) as { n: number }[];
  run.pending = left?.n ?? 0;
  return run;
}
