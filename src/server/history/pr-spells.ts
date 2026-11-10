// Keeps the link from each atlas change to its pull request whole, and fills
// atlas_prs.spell_refs: the spells each PR names, read from its record (title
// and body, scripts/lib/github-pr-cache.mjs) by `prSpellRefs`.
//   - A history row whose commit names its PR ("… (#369)") but was written
//     without its number, because the record could not be fetched then, gets
//     the number from the atlas git log (`backfillPrNumbers`).
//     It reads the git log only after the atlas moved (`prBackfillDue`).
//   - A PR whose record is read gets its spells, stamped with the parser's
//     version, and its title, url, author and review counts where they are
//     missing. A PR read by an older parser is read again, keeping its old
//     answer until then. One whose record cannot be read keeps what it has and
//     is moved to the back of the queue, so it never holds up the rest; when the
//     records are fetched, the first miss ends the tick, since a refusal from
//     GitHub looks the same.
import { prSpellRefs, SPELL_REFS_VERSION } from "../../lib/atlasPrSpell.ts";
import type { SqlTag } from "../sql-types.ts";

export interface PrRecord {
  title: string | null;
  body: string | null;
  url?: string | null;
  author?: string | null;
  reviewCount?: number | null;
  approvalCount?: number | null;
  commentCount?: number | null;
}

export interface PrSpellsResult {
  read: number;
  named: number;
  missing: number;
}

/** A Postgres array literal of hex shas or integers, which need no quoting (pg-array.ts explains why arrays bind as literals). */
const literal = (xs: readonly (string | number)[]) => `{${xs.join(",")}}`;

/**
 * Sets the PR number on every git-era history row of a commit that names one
 * and was stored without it, and makes sure each such PR has an atlas_prs row.
 * `byCommit` is short sha → PR number, from the commit subjects. Returns the
 * number of rows given a PR.
 */
export async function backfillPrNumbers(db: SqlTag, byCommit: ReadonlyMap<string, number>): Promise<number> {
  const shas = [...byCommit.keys()].filter((s) => /^[0-9a-f]{7}$/.test(s));
  if (shas.length === 0) return 0;
  const prs = shas.map((s) => byCommit.get(s)!);
  const rows = (await db`
    UPDATE atlas_history h SET pr_number = v.pr
    FROM unnest(${literal(shas)}::text[], ${literal(prs)}::int[]) AS v(sha, pr)
    WHERE h.commit_sha = v.sha AND h.pr_number IS NULL AND h.era IS NULL
    RETURNING h.pr_number`) as { pr_number: number }[];
  const given = [...new Set(rows.map((r) => r.pr_number))];
  if (given.length) await db`INSERT INTO atlas_prs (pr_number) SELECT unnest(${literal(given)}::int[]) ON CONFLICT (pr_number) DO NOTHING`;
  return rows.length;
}

/** The atlas commit history rows were last given PR numbers at, when the atlas has moved since; null when it has not. */
export async function prBackfillDue(db: SqlTag): Promise<string | null> {
  const [row] = (await db`SELECT atlas_sha, pr_backfill_sha FROM sync_state WHERE id = 1`) as { atlas_sha: string; pr_backfill_sha: string | null }[];
  return row && row.atlas_sha !== row.pr_backfill_sha ? row.atlas_sha : null;
}

/** Records that history rows were given PR numbers at `sha`. */
export async function markPrBackfill(db: SqlTag, sha: string): Promise<void> {
  await db`UPDATE sync_state SET pr_backfill_sha = ${sha} WHERE id = 1`;
}

/** Stores one read record: its spells, stamped with the parser's version, and its metadata where the row lacks it. */
async function storeRecord(db: SqlTag, pr: number, rec: PrRecord): Promise<string[]> {
  const refs = prSpellRefs(rec.title, rec.body);
  await db`UPDATE atlas_prs SET spell_refs = ${refs}::jsonb, spell_refs_version = ${SPELL_REFS_VERSION}, title = COALESCE(title, ${rec.title}),
    url = COALESCE(url, ${rec.url ?? null}), author = COALESCE(author, ${rec.author ?? null}), review_count = COALESCE(review_count, ${rec.reviewCount ?? null}),
    approval_count = COALESCE(approval_count, ${rec.approvalCount ?? null}), comment_count = COALESCE(comment_count, ${rec.commentCount ?? null}), updated_at = now()
    WHERE pr_number = ${pr}`;
  return refs;
}

/**
 * Reads up to `limit` PRs not read yet, then those an older parser read, least
 * recently tried first, and stores the spells each names. With `stopOnMiss`,
 * the first record that cannot be read ends the run.
 */
export async function fillPrSpells(db: SqlTag, record: (pr: number) => Promise<PrRecord | null>, limit: number, stopOnMiss = false): Promise<PrSpellsResult> {
  const rows = (await db`SELECT pr_number FROM atlas_prs WHERE spell_refs IS NULL OR spell_refs_version IS DISTINCT FROM ${SPELL_REFS_VERSION}
    ORDER BY (spell_refs IS NULL) DESC, updated_at ASC, pr_number DESC LIMIT ${limit}`) as { pr_number: number }[];
  const out = { read: 0, named: 0, missing: 0 };
  for (const { pr_number } of rows) {
    const rec = await record(pr_number);
    if (!rec) {
      out.missing++;
      await db`UPDATE atlas_prs SET updated_at = now() WHERE pr_number = ${pr_number}`;
      if (stopOnMiss) break;
      continue;
    }
    const refs = await storeRecord(db, pr_number, rec);
    out.read++;
    if (refs.length) out.named++;
  }
  return out;
}
