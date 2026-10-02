// The data layer behind GET /api/preview/mine — the /preview index's "my recent
// previews" list. Split out of handler.ts so each concern is one function: parse
// the sha list, collect the two sources, decide what this visitor may see. The
// handler keeps only the HTTP shell.
//
// The only export that returns rows is visiblePreviews. parseShaList and
// parseLocalOpens parse the query string and return no rows. Collection and the
// disclosure filter are private, so rows that have not been through the filter
// cannot leave this module.
//
// TWO SOURCES, unioned:
//   the ACCOUNT — every preview this signed-in visitor opened, on any device
//     (preview_opens, written at `ready`). Ranked by that visitor's opened_at.
//   the BROWSER — the shas localStorage sent, each with that browser's own open
//     time (`?at=`). The whole list for an anonymous visitor, and for a signed-in
//     one it covers what they opened before the account history existed or while
//     logged out. Ranked by the time the browser sent, never by last_access —
//     any visitor moves that.
//
// Before the private cap, rows that are the same preview collapse to one: same
// repo and pull-request number, or the same branch when there is no PR. The
// newer open supplies the row; a tie keeps the account row (it carries
// preview_id). A push moves the sha and must not take a second slot. A revoked
// repo shortens the list — we authorize at most eight and do not walk further.
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

/** At most this many distinct private previews are authorized per request — the
 *  newest by the visitor's own open. Each distinct private repo among them costs
 *  a live GitHub permission check (access.ts, ~60s cache), run concurrently, so
 *  this is what bounds the slowest possible response. A revoked repo shortens
 *  the list; we do not walk past this many. */
export const MINE_MAX_PRIVATE = 8;

/** One localStorage open, as the browser reported it. `at` is that browser's
 *  own clock (epoch ms), never the preview row's last_access. */
export interface BrowserOpen {
  sha: string;
  at: number;
}

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
 * links for real. `browserAt` is the clock from `?at=`, keyed by sha.
 */
export async function visiblePreviews(
  req: Request,
  userId: string | null,
  shas: string[],
  authorize: (req: Request, repo: string) => Promise<AccessDecision> = authorizePreviewAccess,
  browserAt: ReadonlyMap<string, number> = new Map(),
): Promise<MineRow[]> {
  return visibleToVisitor(req, await collectMineRows(userId, shas), authorize, browserAt);
}

/** `?shas=` → the 40-hex shas worth querying. Junk entries are dropped rather
 *  than 400'd: one stale localStorage record must not blank the whole list. */
export function parseShaList(raw: string | null): string[] {
  return parseLocalOpens(raw, null).map((o) => o.sha);
}

/** `?shas=` aligned with `?at=` (epoch ms). A repeated sha keeps the newer
 *  time. A missing or junk time is 0, which ranks oldest — last_access is not
 *  a stand-in, because any visitor moves it. */
export function parseLocalOpens(shasRaw: string | null, atRaw: string | null): BrowserOpen[] {
  const shas = (shasRaw ?? "").split(",");
  const ats = (atRaw ?? "").split(",");
  const best = new Map<string, number>();
  for (let i = 0; i < shas.length; i++) {
    const sha = shas[i].trim().toLowerCase();
    if (!SHA_RE.test(sha)) continue;
    const n = Number(ats[i]?.trim());
    const at = Number.isFinite(n) && n > 0 ? n : 0;
    const prev = best.get(sha);
    if (prev === undefined || at > prev) best.set(sha, at);
  }
  return [...best.entries()].slice(0, MINE_MAX_SHAS).map(([sha, at]) => ({ sha, at }));
}

/** Postgres hands timestamps back as Date objects even though the JSON response
 *  carries ISO strings, so accept both (and anything else as "no idea, oldest"). */
function millis(v: unknown): number {
  if (v instanceof Date) return v.getTime();
  return typeof v === "string" ? Date.parse(v) || 0 : 0;
}

/** When this visitor opened the row. An account row carries opened_at. A row
 *  that exists only because the browser named its sha ranks by the timestamp
 *  the browser sent — not last_access. */
function rankAt(row: MineRow, browserAt: ReadonlyMap<string, number>): number {
  if ("preview_id" in row && row.preview_id) return millis(row.opened_at);
  return browserAt.get(row.sha) ?? 0;
}

/** Same preview across two shas: a pull request by its number, otherwise the
 *  branch. A push moves the sha and must not take a second slot. A PR stays
 *  distinct from the branch it was opened from. */
function previewKey(row: MineRow): string {
  return row.pr_number != null ? `${row.repo}\0pr:${row.pr_number}` : `${row.repo}\0ref:${row.ref}`;
}

/** Both sources, in one call. Each fails on its own: a DB hiccup on one must not
 *  blank the other, and neither ever becomes an error the tab has to render.
 *  Both copies come back — visibleToVisitor collapses a branch or PR to one
 *  slot, and the newer open has to be present to win that slot. */
async function collectMineRows(userId: string | null, shas: string[]): Promise<MineRow[]> {
  const [opens, byShas] = await Promise.all([
    userId ? listPreviewOpens(userId).catch(() => []) : Promise.resolve([]),
    shas.length > 0 ? listPreviewsByShas(shas).catch(() => []) : Promise.resolve([]),
  ]);
  return [...opens, ...byShas];
}

/**
 * Drop every row this visitor may not see. THE ONLY PLACE that decides this —
 * listPreviewsByShas and listPreviewOpens both return private rows, so anything
 * that reaches a response must come through here.
 *
 * Public rows need no check: /list-era semantics, they were never secret, and
 * they are not collapsed.
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
  browserAt: ReadonlyMap<string, number>,
): Promise<MineRow[]> {
  // Newest first, and on a tie the account row (it carries preview_id) wins.
  // Then one slot per branch or PR, so a second sha of a preview the visitor
  // already has does not push a distinct preview out of the eight.
  const ranked = rows.filter((r) => r.private).sort((a, b) => {
    const byTime = rankAt(b, browserAt) - rankAt(a, browserAt);
    if (byTime !== 0) return byTime;
    const aAccount = "preview_id" in a && a.preview_id ? 1 : 0;
    const bAccount = "preview_id" in b && b.preview_id ? 1 : 0;
    return bAccount - aAccount;
  });
  const seen = new Set<string>();
  const candidates: MineRow[] = [];
  for (const row of ranked) {
    const key = previewKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(row);
    if (candidates.length === MINE_MAX_PRIVATE) break;
  }
  // Deduped by repo: several previews of one private repo cost ONE permission
  // check, not one each. Concurrent because a cold cache would otherwise
  // serialize the checks into the response; GitHub's App limits are per
  // installation and three calls deep, so eight at once is nowhere near them.
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
