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
 * A PR is redlined against ITS OWN base, or against live nga main — never
 * against the nga-main fork point as a competing candidate. "PR" means a
 * declared base (`prBase`) or a `pull-N` ref (the Contents-only fallback, where
 * the repo's default branch stands in for the unreadable base):
 *   - its `repo` candidate resolved → "repo", no extra compare. When that base
 *     IS nga main the two candidates are one base, collapsed into the `sky`
 *     slot (no switch, no drift vs main itself).
 *   - it did not → "live-main" + reason. The one exception is a PR declared
 *     against nga main whose own compare failed while the canonical one
 *     succeeded: that `sky` candidate is the same base, so it is used.
 * A fork point is what a repo shares with nga main, not what a PR changes: on
 * a repo that carries its own unpublished work it counts all of that work as
 * the PR's (the 2026-09 private-preview reports).
 *
 * A BRANCH (no PR) with both candidates asks GitHub which merge base is later:
 * "ahead" (repo's is later) → "repo", "behind" → "sky", "identical" → collapse
 * to ONE candidate (drop `repo`, keep `sky`), "diverged" or a failed compare →
 * "sky" + reason. A private branch never has a `sky` candidate (pr-diff.ts).
 */
export async function pickAuto(
  resolved: Resolved,
  sky: Candidate | null,
  repo: Candidate | null,
  repoGh: GhClient,
): Promise<AutoPick> {
  if (resolved.prBase || isPullRef(resolved.ref)) {
    const isNgaMain = (c: { repo: string; ref: string }) => c.repo === CANONICAL_REPO && c.ref === CANONICAL_MAIN_REF;
    if (repo) {
      // Prefer the sky candidate's own counts when it resolved; fall back to
      // the repo compare's otherwise. Patches keep comparing against live main
      // — today's canonical-PR behaviour.
      if (isNgaMain(repo)) return autoResult("sky", sky ?? { ...repo, key: "sky" });
      return autoResult("repo", sky ?? undefined, repo);
    }
    if (sky && resolved.prBase && isNgaMain(resolved.prBase)) return autoResult("sky", sky);
    return autoResult("live-main", undefined, undefined, resolved.prBase ? "PR base did not resolve" : "PR base unreadable and no default branch resolved");
  }

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
