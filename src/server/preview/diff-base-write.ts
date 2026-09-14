// Per-candidate diff-pair computation + base-drift wiring, split out of
// diff-base.ts to keep that file within the ~150-line convention.
//
// The base tarball for EVERY candidate's merge base is fetched from the HEAD
// repo (`resolved.repo`), never the candidate's own repo: a merge base is by
// definition an ancestor of the head commit, so it's reachable there — exactly
// what the pre-split build.ts code did. Base-drift's own tip fetch (see
// computeBaseDrift) is the one place that must fetch from the candidate's OWN
// repo instead, since the base branch's CURRENT tip can be ahead of anything
// the head repo's own history contains.

import fs from "node:fs";
import path from "node:path";
import { config } from "../config.ts";
import { makeGhClient, type Resolved } from "./resolve.ts";
import { loadBaseSnapshot, type Snapshot } from "./snapshot.ts";
import { computeDiffArtifacts, type PreviewDiffJson } from "./diff-artifacts.ts";
import { computeBaseDrift } from "./base-drift.ts";
import type { Candidates, Candidate } from "./pr-diff.ts";
import type { BaseKey, BaseCandidateMeta, PreviewBases, PreviewPaths } from "./cache.ts";
import type { DiffLine } from "../../lib/history";
import type { Indexes } from "../retrieval/indexes.ts";

export interface WriteCandidateDiffsOpts {
  resolved: Resolved;
  token: string;
  priv: boolean;
  sha8: string;
  paths: PreviewPaths;
  fetchTree: (repo: string, sha: string, dir: string) => Promise<{ srcDir: string }>;
  head: Snapshot;
  mainDocs: Snapshot;
  live: Indexes;
}

function stripKey(c: Candidate): BaseCandidateMeta {
  const { key: _key, ...meta } = c;
  return meta;
}

function writeDiffPair(outDir: string, key: BaseKey, a: { diff: PreviewDiffJson; patches: Record<string, DiffLine[]> }): void {
  fs.writeFileSync(path.join(outDir, `diff.${key}.json`), JSON.stringify(a.diff));
  fs.writeFileSync(path.join(outDir, `patches.${key}.json`), JSON.stringify(a.patches));
}

/**
 * Load (deduped by mergeBase, so two candidates sharing one merge base fetch
 * it once) each present candidate's base snapshot, write its diff/patch pair,
 * copy the `auto` pair to the plain diff.json/patches.json, and compute
 * base-drift for the `repo` candidate.
 */
export async function writeCandidateDiffs(candidates: Candidates, opts: WriteCandidateDiffsOpts): Promise<PreviewBases> {
  const { resolved, token, priv, sha8, paths, fetchTree, head, mainDocs, live } = opts;

  // mergeBase → snapshot, keyed so a shared merge base (sky and repo agreeing)
  // is fetched once. A Promise (not the resolved value) is cached: baseFor is
  // called for both keys before either awaits, so the cache must be populated
  // synchronously on first call to dedupe correctly.
  const baseCache = new Map<string, Promise<Snapshot>>();
  const failedBases = new Set<string>();
  function baseFor(mergeBase: string): Promise<Snapshot> {
    const cached = baseCache.get(mergeBase);
    if (cached) return cached;
    const p = loadBaseSnapshot(
      mergeBase,
      path.join(paths.dir, `base-${mergeBase.slice(0, 8)}`),
      (s, d) => fetchTree(resolved.repo, s, d),
      { atlasCommit: live.meta.atlasCommit, snapshot: () => mainDocs },
    ).catch((e) => {
      console.warn(
        `[preview] ${sha8}: base ${mergeBase.slice(0, 8)} unavailable (${(e as Error).message}) — diffing against live main`,
      );
      failedBases.add(mergeBase);
      return mainDocs;
    });
    baseCache.set(mergeBase, p);
    return p;
  }

  const baseSnapshots: Partial<Record<BaseKey, Snapshot>> = {};
  await Promise.all(
    (["sky", "repo"] as const).map(async (key) => {
      const c = candidates[key];
      if (!c) return;
      const base = await baseFor(c.mergeBase);
      baseSnapshots[key] = base;
      // sky renders against live main (today's behaviour); repo renders
      // against its OWN merge base so a PR's redline never shows drift main
      // or the base branch picked up independently of the change under review.
      const reference = key === "repo" ? base : mainDocs;
      writeDiffPair(paths.outDir, key, computeDiffArtifacts(base, head, reference));
    }),
  );

  if (candidates.auto !== "live-main") {
    fs.copyFileSync(path.join(paths.outDir, `diff.${candidates.auto}.json`), path.join(paths.outDir, "diff.json"));
    fs.copyFileSync(path.join(paths.outDir, `patches.${candidates.auto}.json`), path.join(paths.outDir, "patches.json"));
  }

  const bases: PreviewBases = { auto: candidates.auto };
  if (candidates.reason) bases.reason = candidates.reason;
  if (candidates.sky) bases.sky = stripKey(candidates.sky);
  if (candidates.repo) {
    const repoCandidate = candidates.repo;
    bases.repo = stripKey(repoCandidate);
    try {
      const drift = await computeBaseDrift({
        candidate: repoCandidate,
        prBaseSha: resolved.prBase?.sha,
        priv,
        repoGh: makeGhClient(token),
        canonicalGh: makeGhClient(config.githubToken),
        live: { atlasCommit: live.meta.atlasCommit ?? "", snapshot: () => mainDocs },
        // Only the REAL merge-base snapshot is reusable here — a base that
        // failed to load above fell back to mainDocs, which is not the base tip.
        mergeBaseSnapshot: failedBases.has(repoCandidate.mergeBase) ? undefined : baseSnapshots.repo,
        fetchTree: (s, d) => fetchTree(repoCandidate.repo, s, d),
        scratchDir: paths.dir,
      });
      if (drift) bases.repo.drift = drift;
    } catch {
      /* computeBaseDrift is already soft internally; guard anyway — banner meta, never build-blocking */
    }
  }
  return bases;
}
