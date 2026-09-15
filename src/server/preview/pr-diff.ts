// Preview diff-base CANDIDATE resolution.
//
// A preview has up to two diff-base candidates:
//   sky  = merge base of the head with sky-ecosystem/next-gen-atlas:main (the
//          fork point). Public: a canonical compare (fork commits are reachable
//          through the canonical network even when the head repo isn't itself a
//          registered GitHub fork). Private: never a true fork (shared history
//          is mirrored, not forked, so a cross-repo compare 404s) — found by
//          walking commit lists instead (fork-point.ts).
//   repo = merge base of the head with the head repo's OWN base: the PR's
//          declared base branch (`resolved.prBase`) for a PR, or the repo's
//          default branch (`resolved.defaultBranch`) for a branch preview.
//          Canonical-repo branch previews get none (would coincide with sky);
//          a PR keeps its `repo` candidate even against canonical — its
//          declared base is the meaningful diff regardless of repo.
//
// `auto` picks which candidate a preview actually redlines against: a PR
// always prefers `repo` when one resolved; a branch with both asks GitHub
// which merge base is later.
//
// This used to fetch the PR's changed FILES (with unified patch bodies) so a
// path→doc_no mapper could decide which documents a preview touched. That
// only worked while one file held one document; doc-level diffing moved to
// snapshot.ts (uuid-keyed), so nothing reads a file list any more — fetching
// one was pure cost (up to 5,000 paginated files with patch bodies).

import { makeGhClient, CANONICAL_REPO, CANONICAL_MAIN_REF, type Resolved, type GhClient } from "./resolve.ts";
import { config } from "../config.ts";
import { resolveForkPoint } from "./fork-point.ts";
import type { BaseKey, BaseCandidateMeta } from "./cache.ts";
import { pickAuto } from "./pr-diff-auto.ts";

export { pickAuto } from "./pr-diff-auto.ts";

export const COMPARE_BASE = CANONICAL_MAIN_REF;

/** Compare failed outright (404 = no common ancestor / unknown sha). For a
 *  public fork this is fatal — shared history with main is a screening
 *  requirement (build.ts's "not-derived" rejection). */
export class CompareError extends Error {
  status: number;
  constructor(status: number) {
    super(`compare failed (${status})`);
    this.status = status;
  }
}

export interface Candidate extends BaseCandidateMeta {
  key: BaseKey;
}

export interface Candidates {
  sky?: Candidate;
  repo?: Candidate;
  auto: BaseKey | "live-main";
  /** Why `auto` is what it is when that isn't obvious: a degrade cause or
   *  "candidates diverged". */
  reason?: string;
  /** The public sky compare succeeded (didn't throw) — build.ts's `not-derived`
   *  screen for public forks keys on this, not on whether a candidate resulted. */
  compareOk: boolean;
}

/**
 * sky candidate. Public: canonical compare of the served atlasCommit (falls
 * back to COMPARE_BASE when unknown) against the bare head sha, on
 * CANONICAL_REPO — throws CompareError on failure exactly as the old
 * fetchCompare did. Private: found by walking commit lists (fork-point.ts);
 * null (never a throw) when no fork point turns up.
 */
export async function skyCandidate(
  resolved: Resolved,
  opts: { canonicalGh: GhClient; repoGh: GhClient; priv: boolean; atlasCommit?: string | null },
): Promise<Candidate | null> {
  const { canonicalGh, repoGh, priv, atlasCommit } = opts;
  const base = atlasCommit ?? COMPARE_BASE;

  if (priv) {
    const fp = await resolveForkPoint({ repoGh, canonicalGh, repo: resolved.repo, tip: resolved.sha, atlasCommit: base });
    return fp
      ? { key: "sky", repo: CANONICAL_REPO, ref: "main", mergeBase: fp.mergeBase, aheadBy: fp.aheadBy, behindBy: fp.behindBy }
      : null;
  }

  const r = await canonicalGh.fetchJson(
    `/repos/${CANONICAL_REPO}/compare/${encodeURIComponent(base)}...${encodeURIComponent(resolved.sha)}`,
  );
  if (!r.ok) throw new CompareError(r.status);
  const mergeBase = r.json?.merge_base_commit?.sha;
  if (typeof mergeBase !== "string" || !mergeBase) return null;
  return { key: "sky", repo: CANONICAL_REPO, ref: "main", mergeBase, aheadBy: r.json?.ahead_by, behindBy: r.json?.behind_by };
}

/**
 * repo candidate. A PR compares against its OWN declared base branch
 * (`resolved.prBase`) UNCONDITIONALLY — even a canonical `pull-N` against
 * `main` gets one (redundant with sky, harmless; pickAuto forces "repo" for a
 * PR without an extra compare). A branch compares against the head repo's
 * default branch, skipped when there is none, the repo is canonical
 * (coincides with sky), or the branch IS the default branch. Soft throughout:
 * a failed compare or a response with no merge base is null, never a throw.
 * Never reads `resolved.pr.number` — the base is `prBase`/`defaultBranch`,
 * both resolved upstream.
 */
export async function repoCandidate(resolved: Resolved, repoGh: GhClient): Promise<Candidate | null> {
  let compareRepo: string;
  let baseRef: string;
  if (resolved.prBase) {
    compareRepo = resolved.prBase.repo;
    baseRef = resolved.prBase.ref;
  } else if (resolved.defaultBranch && resolved.repo !== CANONICAL_REPO && resolved.ref !== resolved.defaultBranch) {
    compareRepo = resolved.repo;
    baseRef = resolved.defaultBranch;
  } else {
    return null;
  }

  const r = await repoGh.fetchJson(
    `/repos/${compareRepo}/compare/${encodeURIComponent(baseRef)}...${encodeURIComponent(resolved.sha)}`,
  );
  if (!r.ok) return null;
  const mergeBase = r.json?.merge_base_commit?.sha;
  if (typeof mergeBase !== "string" || !mergeBase) return null;
  return { key: "repo", repo: compareRepo, ref: baseRef, mergeBase, aheadBy: r.json?.ahead_by, behindBy: r.json?.behind_by };
}

/**
 * Resolves both candidates concurrently, then picks `auto`. Never rejects: a
 * `CompareError` from the public sky compare (or any other throw) becomes
 * `compareOk: false` with no sky candidate; a `null` from the private
 * fork-point walk still counts as ok. `token` is the BUILD token (installation
 * token for private, service token for public); canonical-side calls always
 * use `config.githubToken` — an installation token can't read canonical.
 */
export async function resolveCandidates(
  resolved: Resolved,
  opts: { token: string; priv: boolean; atlasCommit?: string | null },
): Promise<Candidates> {
  const repoGh = makeGhClient(opts.token);
  const canonicalGh = makeGhClient(config.githubToken);

  const [skyR, repoR] = await Promise.allSettled([
    skyCandidate(resolved, { canonicalGh, repoGh, priv: opts.priv, atlasCommit: opts.atlasCommit }),
    repoCandidate(resolved, repoGh),
  ]);

  const compareOk = skyR.status === "fulfilled";
  const sky = skyR.status === "fulfilled" ? skyR.value : null;
  const repo = repoR.status === "fulfilled" ? repoR.value : null;

  const picked = await pickAuto(resolved, sky, repo, repoGh);
  return { ...picked, compareOk };
}
