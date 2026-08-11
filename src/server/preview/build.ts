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
import { getIndexes } from "../retrieval/indexes.ts";
import { fetchAndExtract, CapExceededError, SourceGoneError } from "./tarball.ts";
import { fetchPreviewFiles, type PreviewFiles } from "./pr-diff.ts";
import { contentDiff } from "./patch-diff.ts";
import {
  diffSnapshots,
  loadBaseSnapshot,
  snapshotFromDocsJson,
  type Snapshot,
} from "./snapshot.ts";
import type { DiffLine } from "../../lib/history";
import { detectIdentitySwaps } from "./identity.ts";
import { previewPaths, writeMeta, evictLru, type PreviewMeta } from "./cache.ts";
import {
  upsertPreview,
  isKnownSha,
  isBlockedSha,
  previewsTodayCount,
  previewsTodayCountForOwner,
  previewsTodayCountForRepo,
} from "./db.ts";
import { isFork, repoOwner, makeGhClient, type Resolved } from "./resolve.ts";
import { installationToken, appInstallUrl } from "./github-app.ts";
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
  | "quota-exceeded"
  // Private-preview error codes. This module only ever emits app-not-installed
  // (installation lookup/token mint failed); auth-required/forbidden/unavailable
  // are emitted by the request handler (login-gate / collaborator-check) but
  // share this type so the PreviewEvent.code union compiles for both.
  | "app-not-installed"
  | "auth-required"
  | "forbidden"
  | "unavailable";

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
// Exported so its real subprocess behavior (exit code + stderr capture) is
// unit-testable directly against a trivial `bun -e` script, without needing the
// actual build pipeline scripts — the DI seam on BuildDeps only lets tests swap
// this out, never exercise the real implementation itself.
export function spawnBuild(args: string[], env: Record<string, string>): Promise<{ code: number; stderr: string }> {
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
// lines (the invariant/exception summary), minus stack-trace noise. Exported
// for direct unit testing of the trimming rules.
export function buildErrorTail(stderr: string): string | undefined {
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
//
// main's addresses.atlas.json is rewritten in place (no atomic temp+rename) by
// the atlas worker's own build cycle, which can race this read. A parse
// failure there is a torn read, not "genuinely zero new addresses" — silently
// returning 0 would hide the swapped-address banner exactly when we can least
// verify it's safe to. Retry once (the worker's write is a single fs call, so
// a short delay almost always lands on the settled file); if it still fails,
// log loudly and return undefined so the caller can tell "checked, zero" apart
// from "couldn't check".
function readAddressMap(p: string): Record<string, unknown> {
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  return j.addresses ?? j;
}

// mainDir defaults to config.publicDir; overridable so the parse-failure-vs-
// zero behavior is testable without touching the real public/ directory.
// Exported for that regression test only.
export async function countNewAddresses(outDir: string, mainDir: string = config.publicDir): Promise<number | undefined> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const previewAddrs = readAddressMap(path.join(outDir, "addresses.atlas.json"));
      const mainAddrs = readAddressMap(path.join(mainDir, "addresses.atlas.json"));
      let n = 0;
      for (const a of Object.keys(previewAddrs)) if (!(a in mainAddrs)) n++;
      return n;
    } catch (e) {
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 150));
        continue;
      }
      console.error(`[preview] countNewAddresses: failed to read address maps for ${outDir}:`, e);
      return undefined;
    }
  /* v8 ignore start -- unreachable: `attempt < 2` bounds the loop to attempts 0
   * and 1, and both always `return` from inside the loop (success above, or the
   * attempt-1 failure branch above), so the loop can never complete normally and
   * fall out to the statement below. It only exists so the function has a total
   * return type; there is no input that reaches past the loop. */
  }
  return undefined;
  /* v8 ignore stop */
}

// Is this preview a FORK preview? PRs are publicly proposed against canonical,
// so they're never fork-treated — even though a PR's head repo usually IS a
// fork. Only bare branch/sha previews of non-canonical repos count. Exported
// for direct unit testing (also reachable indirectly via runBuild, but a fork
// build's meta-shaping needs a fully-mocked build to reach, so a direct test
// is the cheap way to pin this predicate on its own).
export function isForkPreview(resolved: Resolved): boolean {
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
// Exported for direct unit testing: it's already a BuildDeps field (so runBuild
// call sites can fake it), but that DI seam only lets tests SWAP it out — the
// real implementation's own branches (this function's body) are only exercised
// by calling it directly, stubbing globalThis.fetch beneath computeTrust.
export async function forkGate(
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

/** The base PreviewMeta fields that map straight off the resolved ref (the
 *  build then layers on baseAtlasCommit, trust tier, fork/diff stats). Split out
 *  of runBuild so this field mapping — notably headCommitAt from the head commit
 *  date — is unit-testable without driving a full build. */
export function baseMeta(resolved: Resolved, sha: string, docCount: number, t0: number): PreviewMeta {
  return {
    sha,
    repo: resolved.repo,
    ref: resolved.ref,
    kind: resolved.kind,
    prNumber: resolved.pr?.number,
    prTitle: resolved.pr?.title,
    prAuthor: resolved.pr?.author,
    prState: resolved.pr?.state,
    headCommitAt: resolved.date,
    resolvedAt: new Date().toISOString(),
    docCount,
    buildMs: Date.now() - t0,
  };
}

// The side-effecting collaborators runBuild reaches across module boundaries:
// DB reads/writes, the GitHub-App installation token, the tarball fetch, and the
// child-process build steps. Injected (defaulting to the real ones) so the
// private/public build orchestration — the trust/quota branch, installation-token
// acquisition, app-not-installed, and the private meta shaping — is exercisable in
// a hermetic test without a real subprocess, GitHub round-trip, or Postgres. The
// live server always uses realBuildDeps via getOrStartBuild; DI is test-only.
export interface BuildDeps {
  isBlockedSha: (sha: string) => Promise<boolean>;
  isKnownSha: (sha: string) => Promise<boolean>;
  previewsTodayCountForRepo: (repo: string) => Promise<number>;
  forkGate: typeof forkGate;
  installationToken: (repo: string) => Promise<string | null>;
  fetchAndExtract: typeof fetchAndExtract;
  spawnBuild: typeof spawnBuild;
  upsertPreview: (meta: PreviewMeta) => Promise<void>;
}

const realBuildDeps: BuildDeps = {
  isBlockedSha,
  isKnownSha,
  previewsTodayCountForRepo,
  forkGate,
  installationToken,
  fetchAndExtract,
  spawnBuild,
  upsertPreview,
};

async function runBuild(f: Inflight, resolved: Resolved, deps: BuildDeps = realBuildDeps): Promise<void> {
  const sha = resolved.sha;
  const paths = previewPaths(sha);
  const t0 = Date.now();
  // Private previews (branch-only grammar, see resolve.ts) are gated on GitHub
  // App installation, not fork/trust screening — installation IS the trust
  // grant, since only someone who can install the App on the repo can produce
  // a preview of it at all.
  const priv = !!resolved.private;
  try {
    // Admin takedown: a blocked sha never rebuilds.
    if (await deps.isBlockedSha(sha)) {
      fail(f, sha, "not-found");
      return;
    }
    let gate: { tier?: TrustTier; count: () => Promise<number>; quota: number } | undefined;
    if (priv) {
      // Quota gates only NEW analyses; re-builds of a known sha are free.
      if (!(await deps.isKnownSha(sha)) && (await deps.previewsTodayCountForRepo(resolved.repo)) >= config.previewPrivateDailyQuota) {
        fail(f, sha, "quota-exceeded");
        return;
      }
    } else {
      const g = await deps.forkGate(resolved);
      if (g === "fork-not-trusted") {
        fail(f, sha, "fork-not-trusted");
        return;
      }
      gate = g;
      // Quota gates only NEW analyses; re-builds of a known sha are free.
      if (!(await deps.isKnownSha(sha)) && (await gate.count()) >= gate.quota) {
        fail(f, sha, "quota-exceeded");
        return;
      }
    }
    // Private previews fetch via an installation token (the service token in
    // config.githubToken has no access to a private repo); public previews keep
    // the existing service-token path. Checked before acquiring the build slot
    // so a dead installation never occupies a concurrency slot.
    const token = priv ? await deps.installationToken(resolved.repo) : config.githubToken;
    // Only the private path can yield null here (installationToken failed);
    // the public path is config.githubToken, always a string. Narrowing on
    // `== null` proves `token: string` below without a non-null assertion.
    if (token == null) {
      // Carry the install URL so the client can offer a one-click install action.
      fail(f, sha, "app-not-installed", (await appInstallUrl().catch(() => null)) ?? undefined);
      return;
    }
    await acquire();
    try {
      emit(f, { phase: "fetching", sha });
      // Accurate diff is an independent GitHub round-trip — kick it off now so it
      // overlaps the tarball fetch + the whole build. For canonical previews a
      // failure is non-fatal (serve-time vs-main fallback); for forks a failed
      // compare means no shared history with main → the build is rejected.
      // Private previews skip this entirely — no PR/fork compare is meaningful
      // for a private-repo branch, and the service token can't see it anyway.
      const wantCompare = !priv && !!config.githubToken;
      const filesP: Promise<{ ok: true; v: PreviewFiles } | { ok: false }> = wantCompare
        ? fetchPreviewFiles(resolved, config.githubToken).then(
            (v) => ({ ok: true as const, v }),
            () => ({ ok: false as const }),
          )
        : Promise.resolve({ ok: false as const });

      fs.rmSync(paths.dir, { recursive: true, force: true });
      fs.mkdirSync(paths.outDir, { recursive: true });
      const { srcDir, docCount } = await deps.fetchAndExtract(resolved.repo, sha, token, paths.srcDir, undefined, {
        apiTarball: priv,
      });

      emit(f, { phase: "building", sha });
      const base = { ATLAS_SRC_DIR: srcDir, ATLAS_OUT_DIR: paths.outDir, ATLAS_COMMIT: sha };
      // build-index strictness (parseTree invariants) makes a malformed PR exit
      // non-zero → build-failed (with the violation surfaced), never a 500.
      const index = await deps.spawnBuild(["scripts/required/build-index.mjs"], base);
      if (index.code !== 0) return fail(f, sha, "build-failed", buildErrorTail(index.stderr));
      // graph + glossary both consume only build-index's docs.json and write
      // disjoint files (graph: graph/relations/addresses.atlas; glossary:
      // glossary) — run them concurrently.
      const [graph, glossary] = await Promise.all([
        deps.spawnBuild(["scripts/required/build-graph.mjs"], { ...base, ATLAS_ONCHAIN_DIR: config.publicDir }),
        deps.spawnBuild(["scripts/required/build-glossary.mjs"], { ATLAS_OUT_DIR: paths.outDir }),
      ]);
      if (graph.code !== 0 || glossary.code !== 0)
        return fail(f, sha, "build-failed", buildErrorTail(graph.code !== 0 ? graph.stderr : glossary.stderr));

      // A private repo is structurally `isFork` (any non-canonical repo is) but
      // must never get fork treatment: no not-derived rejection (no compare was
      // attempted above) and no fork banner fields on its meta.
      const fork = !priv && isForkPreview(resolved);
      const filesR = priv ? ({ ok: false as const }) : await filesP;
      // Shared-history screen: a fork whose compare vs main failed (no common
      // ancestor / unknown commit) is not a derivative of the atlas — reject.
      if (fork && !filesR.ok) return fail(f, sha, "not-derived");

      const meta: PreviewMeta = baseMeta(resolved, sha, docCount, t0);
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
      // fork-only (a PR with a fork head is still a PR preview). Private
      // previews were never trust/fork-screened above, so neither applies.
      if (!priv) meta.trustTier = gate!.tier;
      if (fork) {
        meta.forkOwner = repoOwner(resolved.repo);
        if (filesR.ok) {
          meta.aheadBy = filesR.v.aheadBy;
          meta.behindBy = filesR.v.behindBy;
        }
        const newAddrs = await countNewAddresses(paths.outDir);
        // Fail closed: an unreadable main map is NOT "zero new addresses" — flag
        // it so the banner/interstitial still warn (the swapped-payment-address
        // screen exists for exactly this case).
        if (newAddrs === undefined) meta.addressCheckFailed = true;
        else meta.newAddresses = newAddrs;
      }
      if (priv) {
        meta.private = true;
        // No GitHub compare was attempted for private previews, but the
        // swapped-payment-address screen is a purely local file compare (this
        // bundle's addresses.atlas.json vs main's) — still worth running.
        const newAddrs = await countNewAddresses(paths.outDir);
        if (newAddrs === undefined) meta.addressCheckFailed = true;
        else meta.newAddresses = newAddrs;
      }
      writeMeta(sha, meta);
      await deps.upsertPreview(meta);
      // Accurate merge-base diff (PR, branch, or fork), written into the bundle as
      // two artifacts: diff.json (added/changed ids — eager, drives markers) and
      // patches.json (id → DiffLine[] — lazy, drives preview history). For
      // canonical previews a failure is non-fatal: no diff.json → serve-time
      // vs-main fallback.
      try {
        if (filesR.ok && filesR.v.mergeBase) {
          const byId = snapshotFromDocsJson(paths.outDir);
          const mainDocs = getIndexes().docMap;
          // Which docs this preview adds/changes, by DOCUMENT IDENTITY rather
          // than by changed filename. Filenames stopped identifying documents
          // when the atlas consolidated ~11k document.md files into ~16 composed
          // files (upstream #294) — one changed file now spans a whole Scope.
          // Comparing uuid-keyed snapshots is layout-blind, so it survives that
          // regrouping and the next one.
          const base = await loadBaseSnapshot(
            filesR.v.mergeBase,
            path.join(paths.dir, "base"),
            // Same injected fetcher, token, and tarball route the head build used
            // — only reachable on the public path (private previews set
            // wantCompare = false), but it must not diverge if that ever changes.
            (s, dir) =>
              deps.fetchAndExtract(resolved.repo, s, token, dir, undefined, { apiTarball: priv }),
            { atlasCommit: getIndexes().meta.atlasCommit, snapshot: () => mainDocs as Snapshot },
          );
          const { added, changed } = diffSnapshots(base, byId);
          // An ADDED doc has no prior content anywhere — render its body as pure
          // additions. CHANGED docs get their patch from the vs-main identity
          // diff below.
          const patches: Record<string, DiffLine[]> = {};
          for (const id of added) {
            const dl = contentDiff("", byId.get(id)?.content ?? "");
            if (dl.length) patches[id] = dl;
          }
          // For CHANGED docs the rendered redline is this uuid's content here vs
          // on the LIVE atlas (what the reader is comparing against on screen),
          // and renumberings are recorded explicitly.
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
          // UUID-identity reassignment: a stable uuid whose underlying document
          // was wholly replaced (title changed + body rewritten), and — best
          // effort — where the displaced old content moved to. Treated as a
          // distinct WARNING in the UI, not an ordinary +/Δ.
          const { identitySwap, formerUuid } = detectIdentitySwaps({ changed, added, mainById: mainDocs, previewById: byId });
          fs.writeFileSync(
            path.join(paths.outDir, "diff.json"),
            JSON.stringify({ added, changed, renumbered, reusedSlot, identitySwap, formerUuid }),
          );
          fs.writeFileSync(path.join(paths.outDir, "patches.json"), JSON.stringify(patches));
        } else if (filesR.ok) {
          // No merge base from GitHub → no trustworthy base side. Skip diff.json
          // rather than guess; the reader falls back to the serve-time vs-main diff.
          console.warn(`[preview] ${sha.slice(0, 8)}: no merge base — skipping doc-level diff`);
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

/** Test-only sibling of getOrStartBuild that threads injected deps through,
 *  while still going through the REAL inflight map — unlike __runBuildForTest
 *  (which builds a standalone Inflight the map never sees), this is what lets a
 *  test exercise the dedup map itself: the concurrency semaphore shared across
 *  distinct shas, and subscribeBuild/emit's fan-out + dedup for a sha that's
 *  actually tracked. Never called by the server; getOrStartBuild always uses
 *  realBuildDeps with no override. */
export function __getOrStartBuildForTest(resolved: Resolved, deps: Partial<BuildDeps>): Inflight {
  const sha = resolved.sha;
  const existing = inflight.get(sha);
  if (existing) return existing;
  const f: Inflight = { sha, current: { phase: "fetching", sha }, subscribers: new Set(), done: false, promise: Promise.resolve() };
  inflight.set(sha, f);
  f.promise = runBuild(f, resolved, { ...realBuildDeps, ...deps }).finally(() => inflight.delete(sha));
  return f;
}

/** Test-only: run a single build to completion against injected deps and resolve
 *  to the terminal PreviewEvent (`f.current`). Bypasses the inflight map/SSE hub
 *  (covered elsewhere) so the private/public build orchestration can be exercised
 *  hermetically — no real subprocess, GitHub round-trip, or Postgres. Never called
 *  by the server; getOrStartBuild always uses realBuildDeps. */
export async function __runBuildForTest(resolved: Resolved, deps: Partial<BuildDeps>): Promise<PreviewEvent> {
  const f: Inflight = {
    sha: resolved.sha,
    current: { phase: "fetching", sha: resolved.sha },
    subscribers: new Set(),
    done: false,
    promise: Promise.resolve(),
  };
  await runBuild(f, resolved, { ...realBuildDeps, ...deps });
  return f.current;
}
