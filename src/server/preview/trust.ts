// Fork-owner trust scoring. A fork preview's quota pool, warning copy, and the
// refuse gate all derive from the owner's track record of merged PRs into
// sky-ecosystem repos — attackers have no history; real contributors do.
//
// Signals (3 GitHub calls per owner, cached 24h — search API is 30 req/min):
//   orgMerged   — merged PRs authored by {owner} anywhere in the sky-ecosystem org
//   atlasMerged — merged PRs authored by {owner} into the canonical atlas repo
//   accountAgeDays — GitHub account age (blocks burner accounts)
//
// Tiers:
//   trusted — whitelisted org fork, or ≥1 PR merged into the atlas itself
//   known   — merged into the org, never the atlas
//   unknown — no merged history, but an established account (warn + small pool)
//   refused — no merged history AND a fresh account (don't build)
//
// Whitelist exists because org-owned forks (the orgs don't author PRs) score 0
// by search. Trust affects quota + warnings only — every fork keeps the lineage
// screen, fork banner, interstitial, and address warning.

import { CANONICAL_REPO, type GhClient } from "./resolve.ts";

export type TrustTier = "trusted" | "known" | "unknown" | "refused";

export interface Trust {
  tier: TrustTier;
  orgMerged: number;
  atlasMerged: number;
  accountAgeDays: number;
}

export const TRUSTED_FORK_OWNERS = new Set(["Endgame-Edge", "Redline-Group"]);

const MIN_ACCOUNT_AGE_DAYS = Number(process.env.PREVIEW_MIN_ACCOUNT_AGE_DAYS ?? 30);

/** Pure tier mapping — testable without GitHub. */
export function tierFor(
  orgMerged: number,
  atlasMerged: number,
  accountAgeDays: number,
  whitelisted: boolean,
): TrustTier {
  if (whitelisted || atlasMerged >= 1) return "trusted";
  if (orgMerged >= 1) return "known";
  if (accountAgeDays >= MIN_ACCOUNT_AGE_DAYS) return "unknown";
  return "refused";
}

/** PR-ness is cheap (anyone can open a draft PR), so it never UPGRADES
 *  treatment — it only un-refuses, keeping "open a draft PR to preview" viable
 *  for legitimate newcomers. They build with full unknown-tier warnings. */
export function effectivePrTier(t: TrustTier): Exclude<TrustTier, "refused"> {
  return t === "refused" ? "unknown" : t;
}

// 24h cache. Trust changes slowly; this keeps us far under the search-API
// rate limit even under hostile request churn. FIFO cap prevents unbounded
// growth under adversarial churn with many distinct owners.
const cache = new Map<string, { at: number; v: Trust }>();
const TTL_MS = 24 * 60 * 60_000;
const MAX_TRUST_CACHE = 1000;

async function searchMergedCount(gh: GhClient, q: string): Promise<number> {
  const r = await gh.fetchJson(`/search/issues?q=${encodeURIComponent(q)}&per_page=1`);
  return r.ok && typeof r.json?.total_count === "number" ? r.json.total_count : 0;
}

/** Compute (or recall) the trust tier for a fork owner. Conservative on API
 *  failure: counts read as 0, so an outage degrades toward stricter tiers —
 *  except account age, where a failed lookup reads as 0 days (refused) only if
 *  the owner also has no merged history. */
export async function computeTrust(owner: string, gh: GhClient): Promise<Trust> {
  const hit = cache.get(owner);
  const now = Date.now();
  if (hit && now - hit.at < TTL_MS) return hit.v;

  const whitelisted = TRUSTED_FORK_OWNERS.has(owner);
  let orgMerged = 0;
  let atlasMerged = 0;
  let accountAgeDays = 0;
  if (!whitelisted) {
    const [org, atlas, user] = await Promise.all([
      searchMergedCount(gh, `is:pr is:merged org:sky-ecosystem author:${owner}`),
      searchMergedCount(gh, `is:pr is:merged repo:${CANONICAL_REPO} author:${owner}`),
      gh.fetchJson(`/users/${encodeURIComponent(owner)}`),
    ]);
    orgMerged = org;
    atlasMerged = atlas;
    const created = user.ok ? Date.parse(user.json?.created_at ?? "") : NaN;
    accountAgeDays = Number.isFinite(created) ? Math.floor((now - created) / 86_400_000) : 0;
  }

  const v: Trust = { tier: tierFor(orgMerged, atlasMerged, accountAgeDays, whitelisted), orgMerged, atlasMerged, accountAgeDays };
  cache.set(owner, { at: now, v });
  if (cache.size > MAX_TRUST_CACHE) cache.delete(cache.keys().next().value!);
  return v;
}
