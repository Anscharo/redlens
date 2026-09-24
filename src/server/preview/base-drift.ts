// How the `repo` diff-base candidate's BASE BRANCH TIP relates to sky main.
// `docsDiffer` counts documents that differ between that base tip and the live
// atlas — not the redlines the preview renders (those are head vs this base).
// The banner does not show it. Distinct from the candidate's `mergeBase` (a point in
// the past, computed once at build time): this measures where the base
// branch stands RIGHT NOW, so a stale fork shows its staleness even when the
// preview itself hasn't moved.
//
// Every step is soft — a failure degrades that one field to undefined, never
// throws — since this is banner meta, not a build-blocking screen.

import path from "node:path";
import { CANONICAL_REPO, type GhClient } from "./resolve.ts";
import { diffSnapshots, loadBaseSnapshot, type Snapshot } from "./snapshot.ts";
import type { BaseDrift } from "./cache.ts";
import type { Candidate } from "./pr-diff.ts";

export interface ComputeBaseDriftOpts {
  /** The `repo` candidate (never `sky` — sky's own drift vs itself is trivially zero). */
  candidate: Candidate;
  /** resolved.prBase?.sha, when the caller already knows the base tip (avoids
   *  the /branches round-trip; a pinned-sha rebuild never has this). */
  prBaseSha?: string;
  priv: boolean;
  repoGh: GhClient;
  canonicalGh: GhClient;
  live: { atlasCommit: string; snapshot: () => Snapshot };
  /** The candidate's own merge-base snapshot, if the caller already loaded
   *  one — reused instead of a second tarball fetch when the base tip hasn't
   *  moved past its merge base. */
  mergeBaseSnapshot?: Snapshot;
  /** Must fetch from the BASE's repo (`candidate.repo`), not necessarily the
   *  preview's head repo. */
  fetchTree: (sha: string, dir: string) => Promise<{ srcDir: string }>;
  /** loadBaseSnapshot rm's whatever dir it's given — use a subdir of the
   *  caller's own scratch space, never the space itself. */
  scratchDir: string;
}

async function resolveTipSha(candidate: Candidate, prBaseSha: string | undefined, repoGh: GhClient): Promise<string | undefined> {
  if (prBaseSha) return prBaseSha;
  try {
    const r = await repoGh.fetchJson(`/repos/${candidate.repo}/branches/${encodeURIComponent(candidate.ref)}`);
    const sha = r.json?.commit?.sha;
    return r.ok && typeof sha === "string" && sha ? sha : undefined;
  } catch {
    return undefined;
  }
}

/** Ahead/behind between the base tip and the served atlasCommit. Public: a
 *  bare-sha canonical compare (fork commits are reachable through the
 *  canonical network). Private: none — no cross-repo compare is possible, and
 *  counting commits since a shared SHA is meaningless for a mirror that takes
 *  squash-merged upstream by content (see pr-diff.ts). A private base's drift
 *  is reported by CONTENT alone: `docsDiffer`. */
async function tipCounts(
  tipSha: string,
  priv: boolean,
  canonicalGh: GhClient,
  atlasCommit: string,
): Promise<{ forkPoint?: string; commitsAhead?: number; commitsBehind?: number }> {
  if (priv) return {};
  try {
    const r = await canonicalGh.fetchJson(
      `/repos/${CANONICAL_REPO}/compare/${encodeURIComponent(atlasCommit)}...${encodeURIComponent(tipSha)}`,
    );
    if (!r.ok) return {};
    // compare(atlasCommit...tipSha): ahead_by = the base branch's own work
    // since the fork point; behind_by = what sky main added that it hasn't
    // taken — exactly commitsAhead/commitsBehind, no swap.
    return { forkPoint: r.json?.merge_base_commit?.sha, commitsAhead: r.json?.ahead_by, commitsBehind: r.json?.behind_by };
  } catch {
    return {};
  }
}

export async function computeBaseDrift(opts: ComputeBaseDriftOpts): Promise<BaseDrift | undefined> {
  const { candidate, prBaseSha, priv, repoGh, canonicalGh, live, mergeBaseSnapshot, fetchTree, scratchDir } = opts;

  const tipSha = await resolveTipSha(candidate, prBaseSha, repoGh);
  if (!tipSha) return undefined;

  const counts = await tipCounts(tipSha, priv, canonicalGh, live.atlasCommit);

  let docsDiffer: number | undefined;
  try {
    const tipSnapshot =
      tipSha === candidate.mergeBase && mergeBaseSnapshot
        ? mergeBaseSnapshot
        : await loadBaseSnapshot(tipSha, path.join(scratchDir, "base-tip"), fetchTree, live);
    const d = diffSnapshots(live.snapshot(), tipSnapshot);
    docsDiffer = d.added.length + d.changed.length + d.removed.length;
  } catch {
    docsDiffer = undefined;
  }

  return { sha: tipSha, ...counts, docsDiffer, vsAtlasCommit: live.atlasCommit };
}
