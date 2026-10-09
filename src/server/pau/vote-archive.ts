// Executive votes older than the vote record, read from the makerdao/community
// repository (governance/votes) a few files per worker tick into
// executive_archive. A title is stored only when the file's spell address is a
// cast spell (casts.ts) cast on or after the vote's date; any other file is
// rejected with the reason, or kept pending while the casts are not read yet.
// Nothing here touches votes.json: the PAU history joins the archive at read
// time (history.ts), after the vote record.
import type { SqlTag } from "../sql-types.ts";
import { readFrontmatterFields, verdictFor, type ArchiveVerdict } from "./vote-archive-parse.ts";

export const ARCHIVE_BLOB = "https://github.com/makerdao/community/blob/master/governance/votes/";
const RAW = "https://raw.githubusercontent.com/makerdao/community/master/governance/votes/";
const LIST = "https://api.github.com/repos/makerdao/community/contents/governance/votes?ref=master";

export interface ArchiveDeps {
  fetchText: (url: string) => Promise<string>;
  fetchJson: (url: string) => Promise<unknown>;
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

/** An executive's spell expires about 30 days after its vote, so a cast list read past that settles "never cast". */
const CAST_WINDOW_MS = 30 * 86_400_000;

/** The spell's earliest cast, and whether the cast list is read, without error, past `date`'s cast window. */
async function castOf(db: SqlTag, spell: string, date: string | null): Promise<{ first: string | null; casts: boolean }> {
  const [c] = (await db`SELECT min(block_time) FILTER (WHERE spell = ${spell}) AS first, max(block_time) AS last FROM spell_casts`) as { first: Date | string | null; last: Date | string | null }[];
  const [cur] = (await db`SELECT next_block FROM spell_cast_cursor WHERE id = 1 AND last_error IS NULL`) as { next_block: string }[];
  const first = c?.first ? new Date(c.first).toISOString() : null;
  const readPast = !!c?.last && !!date && new Date(c.last).getTime() >= Date.parse(date) + CAST_WINDOW_MS;
  return { first, casts: Number(cur?.next_block ?? 0) > 0 && readPast };
}

async function check(db: SqlTag, deps: ArchiveDeps, file: string): Promise<ArchiveVerdict> {
  const fields = readFrontmatterFields(await deps.fetchText(RAW + encodeURIComponent(file)));
  return verdictFor(fields, fields.spell ? await castOf(db, fields.spell, fields.date) : { first: null, casts: true });
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
    v = await check(db, deps, file);
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
