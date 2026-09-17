// pickAuto — which diff-base candidate (see pr-diff.ts) a preview actually
// redlines against. Split out of pr-diff.ts to keep that file within the
// ~150-line convention; the two candidate resolvers stay there.

import { CANONICAL_REPO, CANONICAL_MAIN_REF, isPullRef, type GhClient, type Resolved } from "./resolve.ts";
import type { BaseKey } from "./cache.ts";
// type-only: pr-diff.ts imports pickAuto from here, so a value import back
// would be a circular dependency.
import type { Candidate, Candidates } from "./pr-diff.ts";

export type AutoPick = Pick<Candidates, "auto" | "reason" | "sky" | "repo">;

function autoResult(auto: BaseKey | "live-main", sky?: Candidate, repo?: Candidate, reason?: string): AutoPick {
  const out: AutoPick = { auto };
  if (sky) out.sky = sky;
  if (repo) out.repo = repo;
  if (reason) out.reason = reason;
  return out;
}

/**
 * A PR forces "repo" whenever one resolved (no extra compare — the PR's
 * declared base is definitionally the meaningful diff), except when that
 * base is sky main itself, which collapses to a single "sky" candidate. A PR
 * whose base could not be read (Contents-only fallback) is still a PR: its
 * stand-in default-branch candidate is forced the same way. A branch with both
 * candidates asks GitHub which merge base is later: "ahead" (repo's is
 * later) → "repo", "behind" → "sky", "identical" → collapse to ONE candidate
 * (drop `repo`, keep `sky`), "diverged" or a failed compare → "sky" + reason.
 */
export async function pickAuto(
  resolved: Resolved,
  sky: Candidate | null,
  repo: Candidate | null,
  repoGh: GhClient,
): Promise<AutoPick> {
  if (resolved.prBase) {
    // A PR whose declared base IS sky main has one meaningful base, not two:
    // its `repo` candidate is the same merge base as `sky`. Collapse to the
    // sky candidate (so the reader sees no switch, drift is not measured
    // against main itself, and patches keep comparing against live main —
    // today's canonical-PR behaviour). Prefer the sky candidate's own counts
    // when it resolved; fall back to the repo compare's otherwise.
    if (repo && repo.repo === CANONICAL_REPO && repo.ref === CANONICAL_MAIN_REF) {
      return autoResult("sky", sky ?? { ...repo, key: "sky" });
    }
    if (repo) return autoResult("repo", sky ?? undefined, repo);
    if (sky) return autoResult("sky", sky);
    return autoResult("live-main");
  }

  // A PR resolved through the Contents-only fallback has no declared base, but
  // it is still a PR and the repo's default branch stands in for that base
  // (resolvePrivateBranch). Force `repo` like the arm above instead of asking
  // which merge base is later: a PR branch that took a newer sky main than the
  // repo's own main carries compares "diverged", and the sky pick that follows
  // counts all of that main's work as this PR's changes.
  if (isPullRef(resolved.ref) && repo) return autoResult("repo", sky ?? undefined, repo);

  if (sky && repo) {
    // A raw network throw must degrade like a non-ok response — resolveCandidates
    // promises never to reject, and this is the one call outside its allSettled.
    const r = await repoGh
      .fetchJson(`/repos/${resolved.repo}/compare/${encodeURIComponent(sky.mergeBase)}...${encodeURIComponent(repo.mergeBase)}`)
      .catch(() => null);
    if (!r?.ok) return autoResult("sky", sky, repo, "candidate compare failed");
    const status = r.json?.status;
    if (status === "ahead") return autoResult("repo", sky, repo);
    if (status === "behind") return autoResult("sky", sky, repo);
    if (status === "identical") return autoResult("sky", sky);
    return autoResult("sky", sky, repo, "candidates diverged");
  }
  if (sky) return autoResult("sky", sky);
  if (repo) return autoResult("repo", undefined, repo);
  return autoResult("live-main");
}
