// Merge base between a repo's tip and canonical sky-ecosystem/next-gen-atlas,
// found WITHOUT a cross-repo GitHub compare. GitHub's compare/merge-base API
// only works within a fork network; a private preview repo shares commit SHAs
// with canonical (mirrored history) but is never registered as a GitHub fork
// of it, so a cross-repo compare 404s. Instead we walk each side's own commit
// list (GitHub paginates `/commits?sha=` within ONE repo, no cross-repo call
// needed) and find the first sha the two lists share.
//
// Known edge case: a private branch forked from a canonical commit NEWER than
// the served atlasCommit walks back through those newer sky commits, none of
// which are in `canonical` (built from the SERVED commit), hits the served
// commit itself first, and reports those newer-than-served commits as the
// fork's own "ahead" work. Rare (only right after an atlas sync lags a fresh
// fork), and self-heals on the next atlas sync once atlasCommit catches up.

import { CANONICAL_REPO, type GhClient } from "./resolve.ts";

const PER_PAGE = 100;
const CANONICAL_MAX_PAGES = 10;
const FORK_MAX_PAGES = 5;

let canonicalCache: { atlasCommit: string; shas: Set<string> } | null = null;
let warnedCapped = false;

export function __resetForkPointCacheForTest(): void {
  canonicalCache = null;
  warnedCapped = false;
}

/**
 * Commit shas reachable from the served canonical commit, first-parent order
 * as GitHub lists them. Single-entry cache keyed on atlasCommit: "behind
 * main" means behind what is SERVED, and the cache refreshes when main moves.
 * A capped walk IS cached — for a fixed atlasCommit the first
 * CANONICAL_MAX_PAGES pages are immutable, so retrying would just refetch the
 * same pages forever until main moves. A page that fails outright (non-ok —
 * transient, not immutable) is NOT cached, so the next call retries it.
 */
export async function canonicalMainShas(gh: GhClient, atlasCommit: string): Promise<Set<string>> {
  if (canonicalCache && canonicalCache.atlasCommit === atlasCommit) return canonicalCache.shas;

  const shas = new Set<string>();
  for (let page = 1; page <= CANONICAL_MAX_PAGES; page++) {
    const r = await gh.fetchJson(
      `/repos/${CANONICAL_REPO}/commits?sha=${encodeURIComponent(atlasCommit)}&per_page=${PER_PAGE}&page=${page}`,
    );
    if (!r.ok || !Array.isArray(r.json)) return shas; // partial, uncached — retry next call
    for (const c of r.json) if (typeof c?.sha === "string") shas.add(c.sha);
    if (r.json.length < PER_PAGE) {
      canonicalCache = { atlasCommit, shas };
      return shas;
    }
    if (page === CANONICAL_MAX_PAGES) {
      if (!warnedCapped) {
        warnedCapped = true;
        console.warn(`[preview] canonicalMainShas: hit the ${CANONICAL_MAX_PAGES}-page cap walking ${atlasCommit.slice(0, 8)}`);
      }
      canonicalCache = { atlasCommit, shas }; // capped but immutable for this atlasCommit — cache it
      return shas;
    }
  }
  return shas;
}

/**
 * Walk `repo`'s own commit list from `tip`; the first sha also present in
 * `canonical` is the fork point. `null` when none turns up within the page
 * cap, or on any non-ok page (never throws).
 */
export async function findForkPoint(
  gh: GhClient,
  repo: string,
  tip: string,
  canonical: Set<string>,
  maxPages: number = FORK_MAX_PAGES,
): Promise<string | null> {
  for (let page = 1; page <= maxPages; page++) {
    const r = await gh.fetchJson(
      `/repos/${repo}/commits?sha=${encodeURIComponent(tip)}&per_page=${PER_PAGE}&page=${page}`,
    );
    if (!r.ok || !Array.isArray(r.json)) return null;
    for (const c of r.json) {
      const sha = c?.sha;
      if (typeof sha === "string" && canonical.has(sha)) return sha;
    }
    if (r.json.length < PER_PAGE) return null; // short page: no more commits to walk
  }
  return null;
}

/**
 * Exact ahead/behind counts once a fork point is known. Each side is an
 * independent compare; either failing leaves just that count undefined —
 * this never throws (a soft banner field, not a screening gate).
 */
export async function forkPointCounts(
  repoGh: GhClient,
  canonicalGh: GhClient,
  repo: string,
  forkPoint: string,
  tip: string,
  atlasCommit: string,
): Promise<{ aheadBy?: number; behindBy?: number }> {
  const [aheadR, behindR] = await Promise.all([
    repoGh
      .fetchJson(`/repos/${repo}/compare/${encodeURIComponent(forkPoint)}...${encodeURIComponent(tip)}`)
      .catch(() => null),
    canonicalGh
      .fetchJson(`/repos/${CANONICAL_REPO}/compare/${encodeURIComponent(forkPoint)}...${encodeURIComponent(atlasCommit)}`)
      .catch(() => null),
  ]);
  return {
    aheadBy: aheadR?.ok ? aheadR.json?.ahead_by : undefined,
    behindBy: behindR?.ok ? behindR.json?.ahead_by : undefined,
  };
}

/** Composes the three: canonical set → fork point → exact counts. `null` = no
 *  fork point found; the caller degrades (no sky candidate / no drift). */
export async function resolveForkPoint(opts: {
  repoGh: GhClient;
  canonicalGh: GhClient;
  repo: string;
  tip: string;
  atlasCommit: string;
}): Promise<{ mergeBase: string; aheadBy?: number; behindBy?: number } | null> {
  const { repoGh, canonicalGh, repo, tip, atlasCommit } = opts;
  const canonical = await canonicalMainShas(canonicalGh, atlasCommit);
  const forkPoint = await findForkPoint(repoGh, repo, tip, canonical);
  if (!forkPoint) return null;
  const counts = await forkPointCounts(repoGh, canonicalGh, repo, forkPoint, tip, atlasCommit);
  return { mergeBase: forkPoint, ...counts };
}
