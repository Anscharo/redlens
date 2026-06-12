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
import { getIndexes } from "../indexes.ts";
import { fetchAndExtract, CapExceededError, SourceGoneError } from "./tarball.ts";
import { fetchPreviewFiles, mapChangedDocs, type PreviewFiles } from "./pr-diff.ts";
import { contentDiff } from "./patch-diff.ts";
import { previewPaths, writeMeta, evictLru, type PreviewMeta } from "./cache.ts";
import { upsertPreview, isKnownSha, isBlockedSha, previewsTodayCount, previewsTodayCountForOwner } from "./db.ts";
import { isFork, repoOwner, makeGhClient, type Resolved } from "./resolve.ts";
import { computeTrust, effectivePrTier, type TrustTier } from "./trust.ts";

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

/** Shas with a build in progress — eviction (post-build + sweeper) must skip
 *  them: a mid-build dir is indistinguishable from an interrupted one. */
export function inflightShas(): Set<string> {
  return new Set(inflight.keys());
}

function emit(f: Inflight, ev: PreviewEvent): void {
  // Dedup: getOrStartBuild seeds `current` as fetching (sent on subscribe) and
  // runBuild emits fetching again — don't re-broadcast an identical event.
  if (JSON.stringify(ev) === JSON.stringify(f.current)) return;
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

// stderr is captured (and still forwarded to the server log) so a failed build
// can tell the user WHAT was malformed — e.g. parseTree invariant violations
// pinpointing the bad document — instead of a generic "could not be built".
function spawnBuild(args: string[], env: Record<string, string>): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    let stderr = "";
    const child = spawn("bun", args, {
      cwd: config.root,
      env: { ...process.env, ...env },
      stdio: ["ignore", "inherit", "pipe"],
      timeout: config.previewBuildTimeoutMs,
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
      process.stderr.write(d);
    });
    child.on("close", (code) => resolve({ code: code ?? 1, stderr }));
    child.on("error", () => resolve({ code: 1, stderr }));
  });
}

// Trim subprocess stderr to a user-displayable reason: the last few meaningful
// lines (the invariant/exception summary), minus stack-trace noise.
function buildErrorTail(stderr: string): string | undefined {
  const lines = stderr
    .split("\n")
    .filter((l) => l.trim() && !/^\s*at /.test(l) && !/^\s*\d+ \|/.test(l) && !/^\s*\^\s*$/.test(l) && !/^Bun v/.test(l));
  const tail = lines.slice(-6).join("\n").slice(-600);
  return tail || undefined;
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

// Is this preview a FORK preview? PRs are publicly proposed against canonical,
// so they're never fork-treated — even though a PR's head repo usually IS a
// fork. Only bare branch/sha previews of non-canonical repos count.
function isForkPreview(resolved: Resolved): boolean {
  return !resolved.pr && isFork(resolved.repo);
}

// Trust screening + quota pool selection. Treatment follows the EFFECTIVE tier
// of whoever is responsible for the content:
//   canonical branch → no author to score, canonical pool
//   PR → score the PR AUTHOR; PR-ness only un-refuses (never upgrades).
//        trusted-author PRs draw from the canonical pool; known/unknown PRs
//        share those fork pools — burner-PR spam can only drain the 2/day pool.
//   bare fork branch → score the fork OWNER; refused tier rejects the build;
//        trusted owners get their own per-owner pool.
async function forkGate(
  resolved: Resolved,
): Promise<{ tier?: TrustTier; count: () => Promise<number>; quota: number } | "fork-not-trusted"> {
  if (!resolved.pr && !isFork(resolved.repo)) {
    return { count: () => previewsTodayCount("canonical"), quota: config.previewDailyQuota };
  }
  const gh = makeGhClient(config.githubToken);
  if (resolved.pr) {
    const tier = effectivePrTier((await computeTrust(resolved.pr.author, gh)).tier);
    if (tier === "trusted")
      return { tier, count: () => previewsTodayCount("canonical"), quota: config.previewDailyQuota };
    if (tier === "known")
      return { tier, count: () => previewsTodayCount("known"), quota: config.previewForkDailyQuota };
    return { tier, count: () => previewsTodayCount("unknown"), quota: config.previewUnknownForkDailyQuota };
  }
  const owner = repoOwner(resolved.repo);
  const trust = await computeTrust(owner, gh);
  if (trust.tier === "refused") return "fork-not-trusted";
  if (trust.tier === "trusted")
    return { tier: "trusted", count: () => previewsTodayCountForOwner(owner), quota: config.previewTrustedForkDailyQuota };
  if (trust.tier === "known")
    return { tier: "known", count: () => previewsTodayCount("known"), quota: config.previewForkDailyQuota };
  return { tier: "unknown", count: () => previewsTodayCount("unknown"), quota: config.previewUnknownForkDailyQuota };
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
    if (!(await isKnownSha(sha)) && (await gate.count()) >= gate.quota) {
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
      // non-zero → build-failed (with the violation surfaced), never a 500.
      const index = await spawnBuild(["scripts/required/build-index.mjs"], base);
      if (index.code !== 0) return fail(f, sha, "build-failed", buildErrorTail(index.stderr));
      // graph + glossary both consume only build-index's docs.json and write
      // disjoint files (graph: graph/relations/addresses.atlas; glossary:
      // glossary) — run them concurrently.
      const [graph, glossary] = await Promise.all([
        spawnBuild(["scripts/required/build-graph.mjs"], { ...base, ATLAS_ONCHAIN_DIR: config.publicDir }),
        spawnBuild(["scripts/required/build-glossary.mjs"], { ATLAS_OUT_DIR: paths.outDir }),
      ]);
      if (graph.code !== 0 || glossary.code !== 0)
        return fail(f, sha, "build-failed", buildErrorTail(graph.code !== 0 ? graph.stderr : glossary.stderr));

      const fork = isForkPreview(resolved);
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
      // Diff baseline: which main this bundle's redlines were computed against.
      // The sweeper evicts the bundle when main moves past it. Cold start
      // (indexes not loaded) leaves it unset → swept as stale, regenerable.
      try {
        meta.baseAtlasCommit = getIndexes().meta.atlasCommit ?? undefined;
      } catch {
        /* indexes not loaded yet */
      }
      // Effective tier rides on every screened preview (PR + fork) — drives the
      // banner warnings, interstitial, and pool accounting. forkOwner stays
      // fork-only (a PR with a fork head is still a PR preview).
      meta.trustTier = gate.tier;
      if (fork) {
        meta.forkOwner = repoOwner(resolved.repo);
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
          ) as { doc_no: string; id: string; content?: string }[];
          const byId = new Map(nodes.map((n) => [n.id, n]));
          const docNoToId = new Map(nodes.map((n) => [n.doc_no, n.id]));
          // Identity-aware added/changed split: a doc uuid absent from the live
          // atlas is NEW even if its file was "modified" (and vice versa).
          const mainDocs = getIndexes().docMap;
          const mainIds = mainDocs.size > 0 ? new Set(mainDocs.keys()) : undefined;
          const { added, changed, patches, noPatch } = mapChangedDocs(filesR.v.files, docNoToId, mainIds);
          // For CHANGED docs, GitHub's per-path patch can cross doc identities
          // (renumbering moves docs between paths). Replace it with an identity
          // diff — this uuid's content here vs on the live atlas — and record
          // renumberings explicitly.
          const renumbered: Record<string, [string, string]> = {};
          for (const id of changed) {
            const mainNode = mainDocs.get(id);
            const prevNode = byId.get(id);
            if (!mainNode || !prevNode) continue;
            const dl = contentDiff(mainNode.content ?? "", prevNode.content ?? "");
            if (dl.length) patches[id] = dl;
            else delete patches[id];
            if (mainNode.doc_no !== prevNode.doc_no) renumbered[id] = [mainNode.doc_no, prevNode.doc_no];
          }
          // ADDED docs in a reused slot (new uuid at a doc number that exists on
          // the live atlas under a different uuid): the GitHub per-path patch
          // shows the old occupant's content being edited away — misleading for
          // a new doc. Flag the reuse and show the doc's own content as pure
          // additions; the old occupant's move shows on its own history entry.
          const mainDocNos = new Map<string, string>();
          for (const [mid, mnode] of mainDocs) mainDocNos.set(mnode.doc_no, mid);
          // id → who held this doc number on the live atlas, and where that doc
          // sits in THIS preview (absent = the occupant was removed). Lets the
          // new doc's history reference the old occupant's move (both sides of
          // a slot swap tell the story).
          const reusedSlot: Record<string, { title: string; movedTo?: string }> = {};
          for (const id of added) {
            const prevNode = byId.get(id);
            if (!prevNode) continue;
            const occupant = mainDocNos.get(prevNode.doc_no);
            if (occupant && occupant !== id) {
              reusedSlot[id] = {
                title: mainDocs.get(occupant)?.title ?? occupant.slice(0, 8),
                movedTo: byId.get(occupant)?.doc_no,
              };
              const dl = contentDiff("", prevNode.content ?? "");
              if (dl.length) patches[id] = dl;
              else delete patches[id];
            }
          }
          fs.writeFileSync(path.join(paths.outDir, "diff.json"), JSON.stringify({ added, changed, renumbered, reusedSlot }));
          fs.writeFileSync(path.join(paths.outDir, "patches.json"), JSON.stringify(patches));
          if (noPatch > 0) console.warn(`[preview] ${sha.slice(0, 8)}: ${noPatch} changed doc(s) had no patch (binary/truncated/rename)`);
        }
      } catch {
        /* diff endpoint falls back to vs-main */
      }
      emit(f, { phase: "ready", sha });
      evictLru(undefined, undefined, inflightShas());
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
