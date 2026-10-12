// A preview's commit-by-commit history: the commits its branch added since its
// diff base, each described as the reader's history tab describes a live
// commit. Computed on demand, streamed while it runs (commit-stream.ts), then
// kept in the bundle (commit-cache.ts). Soft throughout: a failed walk is an
// error event, never a change to the bundle or its build. Its settings are
// read at call time and declared in src/server/env/previews.ts.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createSemaphore } from "../pool.ts";
import { makeAtlasTreeReader, type GitSnapshot } from "../../../scripts/lib/atlas-git-source.ts";
import { writeCommitCache, type CommitHistoryFile } from "./commit-cache.ts";
import { fetchCommits, isoBackend, type FetchOpts } from "./commit-git.ts";
import { commitRange, type CommitMeta } from "./commit-range.ts";
import { openWalk, walkKey, type Send } from "./commit-stream.ts";
import { walkCommits, type CommitRecord } from "./commit-walk.ts";
import type { WalkPlan } from "./commit-plan.ts";

export interface WalkDeps {
  commitRange: typeof commitRange;
  fetchCommits: (o: FetchOpts) => Promise<void>;
  loadSnapshot: (gitdir: string) => (sha: string) => Promise<GitSnapshot>;
  writeCache: (sha: string, f: CommitHistoryFile) => void;
  maxCommits: () => number;
  timeoutMs: () => number;
}

export const defaultWalkDeps: WalkDeps = {
  commitRange,
  fetchCommits,
  loadSnapshot: (gitdir) => makeAtlasTreeReader(isoBackend(gitdir)).loadSnapshot,
  writeCache: (sha, f) => writeCommitCache(sha, f),
  maxCommits: () => Number(process.env.PREVIEW_COMMIT_HISTORY_MAX_COMMITS ?? 100),
  timeoutMs: () => Number(process.env.PREVIEW_COMMIT_HISTORY_TIMEOUT_MS ?? 120_000),
};

class WalkError extends Error {
  readonly reason: "range-failed" | "fetch-failed" | "timeout";
  constructor(reason: WalkError["reason"]) {
    super(reason);
    this.reason = reason;
  }
}

/** Reject at the deadline; the work itself is left to settle on its own. */
function beforeDeadline<T>(work: Promise<T>, deadline: number): Promise<T> {
  work.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new WalkError("timeout")), Math.max(0, deadline - Date.now()));
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/** Log why a fetch failed (safe: credentials never reach the URL) and name it. */
function fetchFailed(plan: WalkPlan, e: unknown): WalkError {
  console.error(`[preview] commit history ${plan.sha.slice(0, 7)}/${plan.base}: fetch from ${plan.fetchRepo} failed:`, (e as Error).message);
  return new WalkError("fetch-failed");
}

/** Throttle git's progress reports to a few a second, plus each phase change. */
function progress(emit: Send): FetchOpts["onProgress"] {
  let last = 0;
  let phase = "";
  return (p) => {
    const now = Date.now();
    if (p.phase === phase && now - last < 250) return;
    last = now;
    phase = p.phase;
    emit({ type: "fetching", phase: p.phase, loaded: p.loaded, total: p.total });
  };
}

async function describe(plan: WalkPlan, commits: CommitMeta[], emit: Send, d: WalkDeps, deadline: number) {
  const records: CommitRecord[] = [];
  const gitdir = fs.mkdtempSync(path.join(os.tmpdir(), "redlens-commits-"));
  try {
    const fetch = d.fetchCommits({ repo: plan.fetchRepo, sha: plan.sha, depth: commits.length + 1, token: plan.fetchToken, gitdir, onProgress: progress(emit) });
    await beforeDeadline(fetch.catch((e) => Promise.reject(fetchFailed(plan, e))), deadline);
    const r = await walkCommits(commits, {
      loadSnapshot: d.loadSnapshot(gitdir),
      emit: (rec, index) => (records.push(rec), emit({ type: "commit", index, commit: rec })),
      stopped: () => Date.now() > deadline,
    });
    if (Date.now() > deadline) throw new WalkError("timeout");
    return { records, truncated: r.truncated };
  } finally {
    fs.rmSync(gitdir, { recursive: true, force: true });
  }
}

/** Keep a finished walk. Failing to (the bundle was evicted meanwhile) costs
 *  only the next reader a fresh walk, so it never fails the one that ran. */
function keep(plan: WalkPlan, d: WalkDeps, file: CommitHistoryFile): void {
  try {
    d.writeCache(plan.sha, file);
  } catch (e) {
    console.error(`[preview] commit history ${plan.sha.slice(0, 7)}/${plan.base} not kept:`, (e as Error).message);
  }
}

/** One walk, start to finish. Exported for tests; startCommitWalk is the entry point. */
export async function runWalk(plan: WalkPlan, emit: Send, d: WalkDeps = defaultWalkDeps): Promise<void> {
  const deadline = Date.now() + d.timeoutMs();
  try {
    const range = await d.commitRange(plan.gh, plan.compareRepo, plan.mergeBase, plan.sha, d.maxCommits());
    if (!range) throw new WalkError("range-failed");
    emit({ type: "range", total: range.total, walking: range.commits.length });
    const out = range.commits.length ? await describe(plan, range.commits, emit, d, deadline) : { records: [], truncated: false };
    const truncated = range.total > out.records.length;
    keep(plan, d, { version: 1, base: plan.base, mergeBase: plan.mergeBase, head: plan.sha, total: range.total, truncated, commits: out.records });
    emit({ type: "done", truncated });
  } catch (e) {
    if (!(e instanceof WalkError)) console.error(`[preview] commit history ${plan.sha.slice(0, 7)}/${plan.base} failed:`, (e as Error).message);
    emit({ type: "error", reason: e instanceof WalkError ? e.reason : "failed" });
  }
}

const slots = createSemaphore(() => Number(process.env.PREVIEW_MAX_CONCURRENT_COMMIT_WALKS ?? 2));

/** Register and run a walk under the concurrency cap. The caller joins it
 *  (commit-stream.ts joinWalk) to follow it. */
export function startCommitWalk(plan: WalkPlan, d: WalkDeps = defaultWalkDeps): void {
  const emit = openWalk(walkKey(plan.sha, plan.base));
  void slots.acquire().then(() => runWalk(plan, emit, d).finally(() => slots.release()));
}
