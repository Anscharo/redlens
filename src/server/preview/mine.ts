// The data layer behind GET /api/preview/mine — the /preview index's "my recent
// previews" list. Split out of handler.ts so each concern is one function: parse
// the sha list, collect the two sources, decide what this visitor may see. The
// handler keeps only the HTTP shell.
//
// Exactly two exports do the work: parseShaList and visiblePreviews. Collection
// and the disclosure filter are private, so rows that have not been through the
// filter cannot leave this module.
//
// TWO SOURCES, unioned:
//   the ACCOUNT — every preview this signed-in visitor opened, on any device
//     (preview_opens, written at `ready`). What a logged-in person expects:
//     history that follows the account, not a browser profile.
//   the BROWSER — the shas localStorage sent. The entire list for an anonymous
//     visitor, and for a signed-in one it covers what they opened before the
//     account history existed or while logged out.
//
// Either way it answers only for previews the CALLER opened. It never asks for,
// and can never be handed, a list of what other people have previewed.

import { listPreviewsByShas, listPreviewOpens, type MinePreviewRow, type PreviewOpenRow } from "./db.ts";
import { authorizePreviewAccess, type AccessDecision } from "./access.ts";

/** A row as it leaves the server. The account half carries the id it was opened
 *  under and this visitor's own last open of it; the browser half carries
 *  neither, because the client already holds both in localStorage. */
export type MineRow = MinePreviewRow | PreviewOpenRow;

const SHA_RE = /^[0-9a-f]{40}$/i;

/** Headroom over previewLocal.ts's MAX_LOCAL (30): a browser cannot legitimately
 *  hold more, and the cap keeps one request's DB work bounded. */
export const MINE_MAX_SHAS = 50;

/** At most this many private previews are considered per request — the newest by
 *  the visitor's own open. Each distinct private repo among them costs a live
 *  GitHub permission check (access.ts, ~60s cache), so this is what bounds the
 *  slowest possible response; the checks themselves run concurrently. */
export const MINE_MAX_PRIVATE = 8;

/**
 * The ONE way to get preview rows for a visitor: collect both sources, then drop
 * everything they may not see. Collection and disclosure stay separate functions
 * — they are separate jobs, and the filter's rules are worth reading on their own
 * — but both are private to this module, so there is no way to obtain the
 * unfiltered rows from outside it. That is the point: the disclosure filter used
 * to be a step a caller had to remember, and a future `json(await collect(…))`
 * would have shipped private rows with nothing to stop it.
 *
 * `authorize` is the seam the tests drive (same idea as build.ts's `deps`): it
 * keeps this suite off a process-global mock of ./access.ts, which access.test.ts
 * links for real.
 */
export async function visiblePreviews(
  req: Request,
  userId: string | null,
  shas: string[],
  authorize: (req: Request, repo: string) => Promise<AccessDecision> = authorizePreviewAccess,
): Promise<MineRow[]> {
  return visibleToVisitor(req, await collectMineRows(userId, shas), authorize);
}

/** `?shas=` → the 40-hex shas worth querying. Junk entries are dropped rather
 *  than 400'd: one stale localStorage record must not blank the whole list. */
export function parseShaList(raw: string | null): string[] {
  return [
    ...new Set(
      (raw ?? "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter((s) => SHA_RE.test(s)),
    ),
  ].slice(0, MINE_MAX_SHAS);
}

/** Postgres hands timestamps back as Date objects even though the JSON response
 *  carries ISO strings, so accept both (and anything else as "no idea, oldest"). */
function millis(v: unknown): number {
  if (v instanceof Date) return v.getTime();
  return typeof v === "string" ? Date.parse(v) || 0 : 0;
}

/** When this visitor last opened the row: their own open for an account row,
 *  else the row's last access — the only recency the server has for a sha the
 *  browser named, and good enough for ranking. */
function openedAt(row: MineRow): number {
  return millis("opened_at" in row ? row.opened_at : row.last_access);
}

/** Both sources, in one call. Each fails on its own: a DB hiccup on one must not
 *  blank the other, and neither ever becomes an error the tab has to render. */
async function collectMineRows(userId: string | null, shas: string[]): Promise<MineRow[]> {
  const [opens, byShas] = await Promise.all([
    userId ? listPreviewOpens(userId).catch(() => []) : Promise.resolve([]),
    shas.length > 0 ? listPreviewsByShas(shas).catch(() => []) : Promise.resolve([]),
  ]);
  // A browser row whose sha an account row already covers is the SAME preview,
  // so drop it: kept, both halves occupy a slot in visibleToVisitor's private cap
  // and a signed-in visitor sees four of their eight private previews. The account
  // row is the one kept — it carries the preview_id — and the client resolves its
  // local ids through the sha map, so that row still answers for them.
  //
  // Nothing beyond that is deduped: the same sha can legitimately have been opened
  // under two ids (`pull-346` and its bare commit), and each of those is its own
  // account row.
  const fromAccount = new Set(opens.map((r) => r.sha));
  return [...opens, ...byShas.filter((r) => !fromAccount.has(r.sha))];
}

/**
 * Drop every row this visitor may not see. THE ONLY PLACE that decides this —
 * listPreviewsByShas and listPreviewOpens both return private rows, so anything
 * that reaches a response must come through here.
 *
 * Public rows need no check: /list-era semantics, they were never secret.
 * A private row is kept only when authorizePreviewAccess says "ok" for its repo;
 * every other decision ("login-required", "forbidden", "unavailable", a throw)
 * drops it silently, so a caller guessing shas cannot tell "no such preview"
 * from "not yours". The check is live rather than trusted from the recorded
 * open, because a collaborator grant can be revoked weeks after it.
 *
 * Input order is preserved — the client sorts by its own recency anyway.
 */
async function visibleToVisitor(
  req: Request,
  rows: MineRow[],
  authorize: (req: Request, repo: string) => Promise<AccessDecision>,
): Promise<MineRow[]> {
  const candidates = rows
    .filter((r) => r.private)
    .sort((a, b) => openedAt(b) - openedAt(a))
    .slice(0, MINE_MAX_PRIVATE);
  // Deduped by repo first: several previews of one private repo (every push
  // makes a new sha) then cost ONE permission check, not one each. Concurrent
  // because a cold cache would otherwise serialize up to MINE_MAX_PRIVATE
  // round trips into the response; GitHub's App limits are per installation and
  // three calls deep, so eight at once is nowhere near them.
  const repos = [...new Set(candidates.map((r) => r.repo))];
  const decisions = new Map(
    await Promise.all(
      repos.map(
        async (repo) =>
          [repo, (await authorize(req, repo).catch(() => "unavailable" as const)) === "ok"] as const,
      ),
    ),
  );
  const keep = new Set<MineRow>(rows.filter((r) => !r.private));
  for (const row of candidates) if (decisions.get(row.repo)) keep.add(row);
  return rows.filter((r) => keep.has(r));
}
