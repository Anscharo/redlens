// Preview comparison metadata from GitHub.
//
// This used to fetch the PR's changed FILES (with unified patch bodies) so a
// path→doc_no mapper could decide which documents a preview touched. That
// mapping only worked while one file held one document; upstream #294
// consolidated ~11k `document.md` files into ~16 composed ones, where a single
// changed file spans a whole Scope. Doc-level diffing moved to snapshot.ts,
// which compares uuid-keyed snapshots of the merge base and the head — so no
// consumer reads a file list any more, and fetching one was pure cost: up to
// 5,000 paginated files with patch bodies on the PR path, plus a per-commit
// union recovery on the compare path whose result was discarded outright (the
// `truncated` flag it existed to compute was already known before it ran).
//
// What is still needed, and why:
//   mergeBase          the base side of the doc-level diff (see snapshot.ts)
//   aheadBy/behindBy   fork banner meta
//   a compare that THROWS on failure — a fork with no common ancestor is not a
//                      derivative of the atlas, and build.ts rejects it as
//                      "not-derived". That is a screening requirement, so the
//                      compare call stays even though its files do not.
//
//   PR              → /pulls/{n} for the base ref, then /compare/{base}...{head}
//                     (a PR's base branch is not always main)
//   branch/sha/fork → /compare/main...{sha}  (three-dot = merge base; fork
//                     commits are reachable through the canonical repo's network)

import { makeGhClient, CANONICAL_REPO, type Resolved, type GhClient } from "./resolve.ts";

const COMPARE_BASE = "main"; // fragile: update if sky-ecosystem/next-gen-atlas renames its default branch

/** Compare failed outright (404 = no common ancestor / unknown sha). For forks
 *  this is fatal — shared history with main is a screening requirement. */
export class CompareError extends Error {
  status: number;
  constructor(status: number) {
    super(`compare failed (${status})`);
    this.status = status;
  }
}

export interface PreviewFiles {
  /** From the compare response; absent on the PR path. */
  aheadBy?: number;
  behindBy?: number;
  /** Commit the head actually forked from — the base side of the doc-level diff
   *  (see snapshot.ts). Absent when GitHub didn't report one. */
  mergeBase?: string;
}

// Compare path: merge-base comparison vs main. Throws on failure so the fork
// shared-history screen in build.ts can reject a non-derivative.
async function fetchCompare(gh: GhClient, sha: string): Promise<PreviewFiles> {
  const r = await gh.fetchJson(`/repos/${CANONICAL_REPO}/compare/${COMPARE_BASE}...${sha}`);
  if (!r.ok) throw new CompareError(r.status);
  return {
    aheadBy: r.json?.ahead_by ?? 0,
    behindBy: r.json?.behind_by ?? 0,
    mergeBase: r.json?.merge_base_commit?.sha,
  };
}

// A PR's merge base is against ITS declared base branch, which is not always
// main. Two calls, and they are what make the doc-level diff exact rather than
// "vs whatever main happens to be right now".
async function fetchPrMergeBase(gh: GhClient, prNumber: number, headSha: string): Promise<string | undefined> {
  const pr = await gh.fetchJson(`/repos/${CANONICAL_REPO}/pulls/${prNumber}`);
  const baseRef: string | undefined = pr.ok ? pr.json?.base?.ref : undefined;
  const cmp = await gh.fetchJson(
    `/repos/${CANONICAL_REPO}/compare/${baseRef ?? COMPARE_BASE}...${headSha}`,
  );
  return cmp.ok ? cmp.json?.merge_base_commit?.sha : undefined;
}

/** PR → merge base via the PR's own base; branch/sha/fork → merge base vs main. */
export async function fetchPreviewFiles(resolved: Resolved, token: string): Promise<PreviewFiles> {
  const gh = makeGhClient(token);
  if (resolved.pr) {
    return { mergeBase: await fetchPrMergeBase(gh, resolved.pr.number, resolved.sha).catch(() => undefined) };
  }
  return fetchCompare(gh, resolved.sha);
}
