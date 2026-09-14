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
import { computeDiffArtifacts, writeDiffArtifacts, type PreviewDiffJson } from "./diff-artifacts.ts";
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
 * it once) each present candidate's base snapshot, write a diff/patch pair
 * for every candidate whose base actually loaded, copy the `auto` pair to the
 * plain diff.json/patches.json, and compute base-drift for the `repo`
 * candidate. A candidate whose merge-base tree could not be fetched is
 * DROPPED from the advertised bases rather than silently redlined against
 * live main under its own name — the label and the bytes must agree; when
 * that was the `auto` candidate, `auto` moves to the other one, or to
 * "live-main" with a reason (and the vs-main pair goes to diff.json).
 */
export async function writeCandidateDiffs(candidates: Candidates, opts: WriteCandidateDiffsOpts): Promise<PreviewBases> {
  const { resolved, token, priv, sha8, paths, fetchTree, head, mainDocs, live } = opts;

  const present = (["sky", "repo"] as const).filter((k) => candidates[k]);
  const loaded = new Map<string, Snapshot>();
  const failed = new Map<string, string>();
  await Promise.all(
    [...new Set(present.map((k) => candidates[k]!.mergeBase))].map(async (mergeBase) => {
      try {
        loaded.set(
          mergeBase,
          await loadBaseSnapshot(
            mergeBase,
            path.join(paths.dir, `base-${mergeBase.slice(0, 8)}`),
            (s, d) => fetchTree(resolved.repo, s, d),
            { atlasCommit: live.meta.atlasCommit, snapshot: () => mainDocs },
          ),
        );
      } catch (e) {
        const why = `base ${mergeBase.slice(0, 8)} unavailable (${(e as Error).message})`;
        failed.set(mergeBase, why);
        console.warn(`[preview] ${sha8}: ${why} — diffing against live main`);
      }
    }),
  );

  const kept = present.filter((k) => loaded.has(candidates[k]!.mergeBase));
  for (const key of kept) {
    const base = loaded.get(candidates[key]!.mergeBase)!;
    // sky renders against live main (today's behaviour); repo renders against
    // its OWN merge base so a PR's redline never shows drift main or the base
    // branch picked up independently of the change under review.
    writeDiffPair(paths.outDir, key, computeDiffArtifacts(base, head, key === "repo" ? base : mainDocs));
  }

  let auto: PreviewBases["auto"] = candidates.auto;
  let reason = candidates.reason;
  if (auto !== "live-main" && !kept.includes(auto)) {
    reason = failed.get(candidates[auto]!.mergeBase) ?? reason;
    auto = kept[0] ?? "live-main";
  }
  if (auto === "live-main") {
    writeDiffArtifacts(paths.outDir, computeDiffArtifacts(mainDocs, head, mainDocs));
  } else {
    fs.copyFileSync(path.join(paths.outDir, `diff.${auto}.json`), path.join(paths.outDir, "diff.json"));
    fs.copyFileSync(path.join(paths.outDir, `patches.${auto}.json`), path.join(paths.outDir, "patches.json"));
  }

  const bases: PreviewBases = { auto };
  if (reason) bases.reason = reason;
  if (kept.includes("sky")) bases.sky = stripKey(candidates.sky!);
  if (kept.includes("repo")) {
    const repoCandidate = candidates.repo!;
    bases.repo = stripKey(repoCandidate);
    try {
      const drift = await computeBaseDrift({
        candidate: repoCandidate,
        prBaseSha: resolved.prBase?.sha,
        priv,
        repoGh: makeGhClient(token),
        canonicalGh: makeGhClient(config.githubToken),
        live: { atlasCommit: live.meta.atlasCommit ?? "", snapshot: () => mainDocs },
        mergeBaseSnapshot: loaded.get(repoCandidate.mergeBase),
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
