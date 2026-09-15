// Preview diff-BASE orchestration: kick off candidate resolution alongside the
// head fetch/build, then — once the head is built — load each candidate's
// base snapshot and write the diff/patch artifact pairs against it.
//
// Extracted from build.ts's inline diff-artifacts block (and the candidate
// kick-off just before the tarball fetch) so the diff-base wiring is testable
// on its own, without driving a full build. The per-candidate compute/write +
// base-drift plumbing lives in diff-base-write.ts (kept separate to stay
// within the file-size convention).
//
// Three snapshots feed every diff pair (see diff-artifacts.ts): `base` (a
// candidate's merge base, or live main when no candidate resolved), `head`
// (this preview's own built docs.json), and `reference` — the snapshot the
// rendered patch compares against, which is live main for the `sky` pair but
// the candidate's OWN merge base for the `repo` pair, so upstream drift never
// shows up inside a PR's redline (see diff-artifacts.ts's header comment).

import { config } from "../config.ts";
import { getIndexes } from "../retrieval/indexes.ts";
import { resolveCandidates, type Candidates } from "./pr-diff.ts";
import { snapshotFromDocsJson, type Snapshot } from "./snapshot.ts";
import { computeDiffArtifacts, writeDiffArtifacts } from "./diff-artifacts.ts";
import { writeCandidateDiffs } from "./diff-base-write.ts";
import type { Resolved } from "./resolve.ts";
import type { PreviewBases, PreviewPaths } from "./cache.ts";

export interface DiffBasesResult {
  candidates: Candidates;
  bases: PreviewBases;
  /** Set when the artifacts could not be written at all (cold start:
   *  getIndexes() threw) — the reader falls back to the serve-time vs-main diff. */
  artifactsSkipped?: string;
}

/**
 * Kick off candidate resolution — network only, so it overlaps the head
 * tarball fetch + build. Skipped (resolves to the stub) only when the build
 * has no way to compare at all: public with no service token. Never rejects:
 * resolveCandidates documents that contract, but pr-diff-auto.ts's `pickAuto`
 * makes one more GitHub call (comparing the two candidates' merge bases) that
 * isn't wrapped in a try/catch, so a raw network throw there would propagate
 * out of resolveCandidates too — the `.catch` below keeps the promise THIS
 * function makes regardless of that gap.
 */
export function startCandidates(resolved: Resolved, token: string, priv: boolean): Promise<Candidates> {
  if (!priv && !config.githubToken) {
    return Promise.resolve({ auto: "live-main", compareOk: false, reason: "no GitHub token, compare skipped" });
  }
  let atlasCommit: string | null | undefined;
  try {
    atlasCommit = getIndexes().meta.atlasCommit;
  } catch {
    atlasCommit = undefined; // indexes not loaded yet — sky candidate falls back to COMPARE_BASE
  }
  return resolveCandidates(resolved, { token, priv, atlasCommit }).catch(
    () => ({ auto: "live-main", compareOk: false }) as Candidates,
  );
}

/**
 * After the head is built: load each candidate's merge-base snapshot, compute
 * + write one diff pair per candidate, copy the `auto` pair to diff.json /
 * patches.json, compute base-drift for the `repo` candidate, and return the
 * meta.bases shape. Never rejects — every failure degrades to live main.
 */
export async function writeDiffBases(
  candidatesP: Promise<Candidates>,
  opts: {
    resolved: Resolved;
    token: string;
    priv: boolean;
    sha: string;
    paths: PreviewPaths;
    /** build.ts wraps deps.fetchAndExtract(repo, sha, token, dir, undefined, { apiTarball: priv }) */
    fetchTree: (repo: string, sha: string, dir: string) => Promise<{ srcDir: string }>;
  },
): Promise<DiffBasesResult> {
  const candidates = await candidatesP;
  const sha8 = opts.sha.slice(0, 8);

  let live: ReturnType<typeof getIndexes>;
  try {
    live = getIndexes(); // cold start (indexes not loaded) → throws → degrade below
  } catch (e) {
    const msg = (e as Error).message;
    console.warn(`[preview] ${sha8}: diff artifacts skipped (${msg}) — reader falls back to the serve-time diff`);
    return { candidates, bases: { auto: "live-main", reason: "indexes not loaded" }, artifactsSkipped: msg };
  }

  const head = snapshotFromDocsJson(opts.paths.outDir);
  const mainDocs = live.docMap as Snapshot;

  // No candidate resolved at all (pickAuto only returns "live-main" when
  // neither sky nor repo came back) — today's plain vs-live-main diff.
  if (candidates.auto === "live-main") {
    const why =
      candidates.reason ?? (opts.priv ? "no fork point found" : candidates.compareOk ? "no merge base" : "compare failed");
    console.warn(`[preview] ${sha8}: ${why} — diffing against live main`);
    writeDiffArtifacts(opts.paths.outDir, computeDiffArtifacts(mainDocs, head, mainDocs));
    return { candidates, bases: { auto: "live-main", reason: candidates.reason } };
  }

  const bases = await writeCandidateDiffs(candidates, {
    resolved: opts.resolved,
    token: opts.token,
    priv: opts.priv,
    sha8,
    paths: opts.paths,
    fetchTree: opts.fetchTree,
    head,
    mainDocs,
    live,
  });
  return { candidates, bases };
}
