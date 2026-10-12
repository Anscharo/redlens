// What one commit-history walk needs, read from the bundle's meta.json: which
// commits (the diff base's merge base to the head), where to read them from, and
// with which credentials.

import { config } from "../config.ts";
import type { BaseKey, PreviewMeta } from "./cache.ts";
import { installationToken } from "./github-app.ts";
import { makeGhClient, type GhClient } from "./resolve.ts";

export interface WalkPlan {
  sha: string;
  base: BaseKey;
  mergeBase: string;
  /** Where the head lives: the bundle's own repo. */
  fetchRepo: string;
  /** Where compare runs: the diff base's repo. */
  compareRepo: string;
  /** Installation token for a private head repo; public repos fetch anonymously. */
  fetchToken: string | null;
  gh: GhClient;
}

/** What a walk needs from the bundle's meta.json; null when the diff base has
 *  no merge base (a live-main degrade), so there is no range to walk, or when a
 *  private head repo has no installation token to fetch it with. */
export async function planWalk(sha: string, base: BaseKey, meta: PreviewMeta, token = installationToken): Promise<WalkPlan | null> {
  const cand = meta.bases?.[base];
  if (!cand?.mergeBase) return null;
  const priv = !!meta.private;
  const compareToken = base === "sky" || !priv ? config.githubToken : ((await token(cand.repo)) ?? "");
  const fetchToken = priv ? await token(meta.repo) : null;
  if (priv && !fetchToken) return null;
  return {
    sha,
    base,
    mergeBase: cand.mergeBase,
    fetchRepo: meta.repo,
    compareRepo: cand.repo,
    fetchToken,
    gh: makeGhClient(compareToken),
  };
}
