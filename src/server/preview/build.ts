// Preview build orchestration + per-sha event hub.
//
// One in-process Map<sha, Inflight> is BOTH the build-dedup and the SSE hub: a
// second request for the same sha attaches to the in-flight build's event stream
// instead of starting a duplicate build. The build spawns the isolated
// index→graph→glossary pipeline (step 2 env overrides) into /tmp/previews/<sha>.
//
// Phases streamed to subscribers: fetching → building → ready | failed.
// (`resolving` is emitted by the handler before the sha is known.)

import fs from "node:fs";
import { spawn } from "node:child_process";
import { config } from "../config.ts";
import { fetchAndExtract, CapExceededError, SourceGoneError } from "./tarball.ts";
import { previewPaths, writeMeta, evictLru, type PreviewMeta } from "./cache.ts";
import { upsertPreview, isKnownSha, previewsTodayCount } from "./db.ts";
import type { Resolved } from "./resolve.ts";

export type PreviewErrorCode =
  | "gate-rejected"
  | "not-found"
  | "source-gone"
  | "cap-exceeded"
  | "build-failed"
  | "rate-limited"
  | "quota-exceeded";

export interface PreviewEvent {
  phase: "resolving" | "fetching" | "building" | "ready" | "failed";
  sha?: string;
  code?: PreviewErrorCode;
  message?: string;
}

type Send = (ev: PreviewEvent) => void;

interface Inflight {
  sha: string;
  current: PreviewEvent;
  subscribers: Set<Send>;
  done: boolean;
  promise: Promise<void>;
}

const inflight = new Map<string, Inflight>();

function emit(f: Inflight, ev: PreviewEvent): void {
  f.current = ev;
  for (const s of f.subscribers) {
    try {
      s(ev);
    } catch {
      /* dead subscriber */
    }
  }
}

/** Attach an SSE sender to an in-flight build. Sends the current phase
 *  immediately; on a terminal phase it won't add the sender (caller closes). */
export function subscribeBuild(sha: string, send: Send): () => void {
  const f = inflight.get(sha);
  if (!f) return () => {};
  send(f.current);
  if (f.done) return () => {};
  f.subscribers.add(send);
  return () => f.subscribers.delete(send);
}

// ---------------------------------------------------------------------------
// Global concurrency semaphore (cap distinct-sha builds; dedup handles same-sha)
// ---------------------------------------------------------------------------
let active = 0;
const waiters: Array<() => void> = [];
function acquire(): Promise<void> {
  if (active < config.previewMaxConcurrentBuilds) {
    active++;
    return Promise.resolve();
  }
  return new Promise((r) => waiters.push(r));
}
function release(): void {
  active--;
  const w = waiters.shift();
  if (w) {
    active++;
    w();
  }
}

function spawnBuild(args: string[], env: Record<string, string>): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("bun", args, {
      cwd: config.root,
      env: { ...process.env, ...env },
      stdio: ["ignore", "inherit", "inherit"],
      timeout: config.previewBuildTimeoutMs,
    });
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

function fail(f: Inflight, sha: string, code: PreviewErrorCode, message?: string): void {
  fs.rmSync(previewPaths(sha).dir, { recursive: true, force: true });
  emit(f, { phase: "failed", sha, code, message });
}

async function runBuild(f: Inflight, resolved: Resolved): Promise<void> {
  const sha = resolved.sha;
  const paths = previewPaths(sha);
  const t0 = Date.now();
  try {
    // Quota gates only NEW analyses; re-builds of a known sha are free.
    if (!(await isKnownSha(sha)) && (await previewsTodayCount()) >= config.previewDailyQuota) {
      fail(f, sha, "quota-exceeded");
      return;
    }
    await acquire();
    try {
      emit(f, { phase: "fetching", sha });
      fs.rmSync(paths.dir, { recursive: true, force: true });
      fs.mkdirSync(paths.outDir, { recursive: true });
      const { srcDir, docCount } = await fetchAndExtract(resolved.repo, sha, config.githubToken, paths.atlasDir);

      emit(f, { phase: "building", sha });
      const base = { ATLAS_SRC_DIR: srcDir, ATLAS_OUT_DIR: paths.outDir, ATLAS_COMMIT: sha };
      // build-index strictness (parseTree invariants) makes a malformed PR exit
      // non-zero → build-failed, never a 500.
      if ((await spawnBuild(["scripts/required/build-index.mjs"], base)) !== 0) return fail(f, sha, "build-failed");
      if ((await spawnBuild(["scripts/required/build-graph.mjs"], { ...base, ATLAS_ONCHAIN_DIR: config.publicDir })) !== 0)
        return fail(f, sha, "build-failed");
      if ((await spawnBuild(["scripts/required/build-glossary.mjs"], { ATLAS_OUT_DIR: paths.outDir })) !== 0)
        return fail(f, sha, "build-failed");

      const meta: PreviewMeta = {
        sha,
        repo: resolved.repo,
        ref: resolved.ref,
        kind: resolved.kind,
        prNumber: resolved.pr?.number,
        prTitle: resolved.pr?.title,
        prAuthor: resolved.pr?.author,
        prState: resolved.pr?.state,
        resolvedAt: new Date().toISOString(),
        docCount,
        buildMs: Date.now() - t0,
      };
      writeMeta(sha, meta);
      await upsertPreview(meta);
      emit(f, { phase: "ready", sha });
      evictLru();
    } finally {
      release();
    }
  } catch (e) {
    const code: PreviewErrorCode =
      e instanceof CapExceededError ? "cap-exceeded" : e instanceof SourceGoneError ? "source-gone" : "build-failed";
    fail(f, sha, code, (e as Error).message);
  } finally {
    f.done = true;
  }
}

/** Start (or attach to) the build for a resolved ref. Returns the Inflight. */
export function getOrStartBuild(resolved: Resolved): Inflight {
  const sha = resolved.sha;
  const existing = inflight.get(sha);
  if (existing) return existing;
  const f: Inflight = { sha, current: { phase: "fetching", sha }, subscribers: new Set(), done: false, promise: Promise.resolve() };
  inflight.set(sha, f);
  // Delete on completion so a failed build can be retried and a ready build
  // short-circuits via bundleReady on the next request.
  f.promise = runBuild(f, resolved).finally(() => inflight.delete(sha));
  return f;
}
