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
import path from "node:path";
import { spawn } from "node:child_process";
import { config } from "../config.ts";
import { fetchAndExtract, CapExceededError, SourceGoneError } from "./tarball.ts";
import { fetchPreviewFiles, mapChangedDocs, type PreviewFiles } from "./pr-diff.ts";
import { previewPaths, writeMeta, evictLru, type PreviewMeta } from "./cache.ts";
import { upsertPreview, isKnownSha, isBlockedSha, previewsTodayCount } from "./db.ts";
import { isFork, repoOwner, makeGhClient, type Resolved } from "./resolve.ts";
import { computeTrust, type TrustTier } from "./trust.ts";

export type PreviewErrorCode =
  | "gate-rejected"
  | "not-found"
  | "not-a-fork"
  | "not-derived"
  | "fork-not-trusted"
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

// Swapped-address screen: how many on-chain addresses does this preview's atlas
// reference that the LIVE atlas does not? Surfaced in the fork banner — targets
// the "fork with a swapped payment address" attack. Key-set compare of the
// bundle's addresses.atlas.json vs main's (shape: { atlasCommit, addresses }).
function countNewAddresses(outDir: string): number {
  try {
    const read = (p: string): Record<string, unknown> => {
      const j = JSON.parse(fs.readFileSync(p, "utf8"));
      return j.addresses ?? j;
    };
    const previewAddrs = read(path.join(outDir, "addresses.atlas.json"));
    const mainAddrs = read(path.join(config.publicDir, "addresses.atlas.json"));
    let n = 0;
    for (const a of Object.keys(previewAddrs)) if (!(a in mainAddrs)) n++;
    return n;
  } catch {
    return 0;
  }
}

// Fork screening + quota pool selection. Canonical/PR previews bypass trust
// scoring and use the main pool; forks are tiered by owner track record.
async function forkGate(
  resolved: Resolved,
): Promise<{ tier?: TrustTier; pool: "trusted" | "known" | "unknown"; quota: number } | "fork-not-trusted"> {
  if (!isFork(resolved.repo)) return { pool: "trusted", quota: config.previewDailyQuota };
  const trust = await computeTrust(repoOwner(resolved.repo), makeGhClient(config.githubToken));
  if (trust.tier === "refused") return "fork-not-trusted";
  if (trust.tier === "trusted") return { tier: "trusted", pool: "trusted", quota: config.previewDailyQuota };
  if (trust.tier === "known") return { tier: "known", pool: "known", quota: config.previewForkDailyQuota };
  return { tier: "unknown", pool: "unknown", quota: config.previewUnknownForkDailyQuota };
}

async function runBuild(f: Inflight, resolved: Resolved): Promise<void> {
  const sha = resolved.sha;
  const paths = previewPaths(sha);
  const t0 = Date.now();
  try {
    // Admin takedown: a blocked sha never rebuilds.
    if (await isBlockedSha(sha)) {
      fail(f, sha, "not-found");
      return;
    }
    const gate = await forkGate(resolved);
    if (gate === "fork-not-trusted") {
      fail(f, sha, "fork-not-trusted");
      return;
    }
    // Quota gates only NEW analyses; re-builds of a known sha are free.
    if (!(await isKnownSha(sha)) && (await previewsTodayCount(gate.pool)) >= gate.quota) {
      fail(f, sha, "quota-exceeded");
      return;
    }
    await acquire();
    try {
      emit(f, { phase: "fetching", sha });
      // Accurate diff is an independent GitHub round-trip — kick it off now so it
      // overlaps the tarball fetch + the whole build. For canonical previews a
      // failure is non-fatal (serve-time vs-main fallback); for forks a failed
      // compare means no shared history with main → the build is rejected.
      const filesP: Promise<{ ok: true; v: PreviewFiles } | { ok: false }> = config.githubToken
        ? fetchPreviewFiles(resolved, config.githubToken).then(
            (v) => ({ ok: true as const, v }),
            () => ({ ok: false as const }),
          )
        : Promise.resolve({ ok: false as const });

      fs.rmSync(paths.dir, { recursive: true, force: true });
      fs.mkdirSync(paths.outDir, { recursive: true });
      const { srcDir, docCount } = await fetchAndExtract(resolved.repo, sha, config.githubToken, paths.atlasDir);

      emit(f, { phase: "building", sha });
      const base = { ATLAS_SRC_DIR: srcDir, ATLAS_OUT_DIR: paths.outDir, ATLAS_COMMIT: sha };
      // build-index strictness (parseTree invariants) makes a malformed PR exit
      // non-zero → build-failed, never a 500.
      if ((await spawnBuild(["scripts/required/build-index.mjs"], base)) !== 0) return fail(f, sha, "build-failed");
      // graph + glossary both consume only build-index's docs.json and write
      // disjoint files (graph: graph/relations/addresses.atlas; glossary:
      // glossary) — run them concurrently.
      const [graphCode, glossaryCode] = await Promise.all([
        spawnBuild(["scripts/required/build-graph.mjs"], { ...base, ATLAS_ONCHAIN_DIR: config.publicDir }),
        spawnBuild(["scripts/required/build-glossary.mjs"], { ATLAS_OUT_DIR: paths.outDir }),
      ]);
      if (graphCode !== 0 || glossaryCode !== 0) return fail(f, sha, "build-failed");

      const fork = isFork(resolved.repo);
      const filesR = await filesP;
      // Shared-history screen: a fork whose compare vs main failed (no common
      // ancestor / unknown commit) is not a derivative of the atlas — reject.
      if (fork && !filesR.ok) return fail(f, sha, "not-derived");

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
      if (fork) {
        meta.forkOwner = repoOwner(resolved.repo);
        meta.trustTier = gate.tier;
        if (filesR.ok) {
          meta.aheadBy = filesR.v.aheadBy;
          meta.behindBy = filesR.v.behindBy;
          if (filesR.v.truncated) meta.diffTruncated = true;
        }
        meta.newAddresses = countNewAddresses(paths.outDir);
      }
      writeMeta(sha, meta);
      await upsertPreview(meta);
      // Accurate merge-base diff (PR, branch, or fork), written into the bundle as
      // two artifacts: diff.json (added/changed ids — eager, drives markers) and
      // patches.json (id → DiffLine[] — lazy, drives preview history). For
      // canonical previews a failure is non-fatal: no diff.json → serve-time
      // vs-main fallback.
      try {
        if (filesR.ok) {
          const nodes = Object.values(
            JSON.parse(fs.readFileSync(path.join(paths.outDir, "docs.json"), "utf8")).nodes,
          ) as { doc_no: string; id: string }[];
          const docNoToId = new Map(nodes.map((n) => [n.doc_no, n.id]));
          const { added, changed, patches, noPatch } = mapChangedDocs(filesR.v.files, docNoToId);
          fs.writeFileSync(path.join(paths.outDir, "diff.json"), JSON.stringify({ added, changed }));
          fs.writeFileSync(path.join(paths.outDir, "patches.json"), JSON.stringify(patches));
          if (noPatch > 0) console.warn(`[preview] ${sha.slice(0, 8)}: ${noPatch} changed doc(s) had no patch (binary/truncated/rename)`);
        }
      } catch {
        /* diff endpoint falls back to vs-main */
      }
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
