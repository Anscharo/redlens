// Preview bundle disk cache — now a thin preview-flavored wrapper over the
// shared per-SHA bundle store (../bundle-store.ts). The generic dir/LRU/serve
// machinery lives there; this file keeps the preview-specific bits: the
// src/out/meta layout, PreviewMeta read/write, and the legacy (sha-first,
// root-overridable) signatures every preview call site + test already use.
//
// Bundles live under PREVIEW_DIR/<sha>/ — ephemeral by design (Railway wipes
// /tmp on every restart/deploy; that's fine, everything regenerates from the
// previews table's sha→repo map). Layout per sha:
//   <sha>/src/        extracted content/** (build source)
//   <sha>/out/        built artifacts (docs.json, relations.json, …)
//   <sha>/meta.json   PreviewMeta (banner + interstitial)
//
// LRU: keep the 20 most-recently-accessed bundles; dir mtime is the access clock.

import fs from "node:fs";
import path from "node:path";
import {
  PREVIEW_DIR,
  PREVIEW_STORE,
  type BundleStore,
  artifactPath as _artifactPath,
  bundleReady as _bundleReady,
  touch as _touch,
  remove as _remove,
  evictLru as _evictLru,
} from "../bundle-store.ts";

export { PREVIEW_DIR };

export interface PreviewMeta {
  sha: string;
  repo: string;
  ref: string;
  kind: "pr" | "branch" | "sha";
  prNumber?: number;
  prTitle?: string;
  prAuthor?: string;
  prState?: "open" | "merged" | "closed";
  /** ISO date of the previewed ref's head commit — the change's real date, shown
   *  on the preview's history entry. Absent on bundles built before it existed. */
  headCommitAt?: string;
  resolvedAt: string;
  docCount: number;
  buildMs: number;
  /** Main atlas commit the bundle's diff/markers were computed against. The
   *  sweeper evicts the bundle once main moves past it (stale redlines). */
  baseAtlasCommit?: string;
  // Trust screening: effective tier of the PR author / fork owner (absent only
  // for canonical-branch previews). forkOwner is set for fork previews only.
  trustTier?: "trusted" | "known" | "unknown" | "refused";
  // Fork previews only (bare branch/sha of a non-canonical repo):
  forkOwner?: string;
  aheadBy?: number;
  behindBy?: number;
  /** Addresses in this preview's atlas not present in the live atlas. */
  newAddresses?: number;
  /**
   * The new-address comparison could not be run (main's addresses.atlas.json was
   * unreadable/torn). Distinct from `newAddresses: 0` — we fail closed and warn,
   * since an unreadable map can't prove the fork introduces no payment addresses.
   */
  addressCheckFailed?: boolean;
  /** Diff recovery was bounded — markers may miss docs on very large forks. */
  /** Built from a private repo — gates every sha-keyed response. */
  private?: boolean;
}

export interface PreviewPaths {
  dir: string;
  srcDir: string;
  outDir: string;
  metaPath: string;
}

export function previewPaths(sha: string, root = PREVIEW_DIR): PreviewPaths {
  const dir = path.join(root, sha);
  return { dir, srcDir: path.join(dir, "src"), outDir: path.join(dir, "out"), metaPath: path.join(dir, "meta.json") };
}

// An ephemeral preview store pinned to a test/override root (the steady-state
// path returns the shared PREVIEW_STORE so its mtime/LRU state is shared).
function storeAt(root: string, keep: number = PREVIEW_STORE.keep): BundleStore {
  return root === PREVIEW_DIR && keep === PREVIEW_STORE.keep ? PREVIEW_STORE : { ...PREVIEW_STORE, root, keep };
}

/** A bundle is ready when its meta + the core artifact exist. */
export function bundleReady(sha: string, root = PREVIEW_DIR): boolean {
  return _bundleReady(storeAt(root), sha);
}

export function readMeta(sha: string, root = PREVIEW_DIR): PreviewMeta | null {
  try {
    return JSON.parse(fs.readFileSync(previewPaths(sha, root).metaPath, "utf8"));
  } catch {
    return null;
  }
}

export function writeMeta(sha: string, meta: PreviewMeta, root = PREVIEW_DIR): void {
  const p = previewPaths(sha, root);
  fs.mkdirSync(p.dir, { recursive: true });
  fs.writeFileSync(p.metaPath, JSON.stringify(meta));
}

/** Resolve an allowlisted artifact path, or null if the name isn't allowed/known. */
export function artifactPath(sha: string, name: string, root = PREVIEW_DIR): string | null {
  return _artifactPath(storeAt(root), sha, name);
}

/** Mark a bundle as just-accessed (LRU clock). */
export function touch(sha: string, root = PREVIEW_DIR): void {
  _touch(storeAt(root), sha);
}

/** Remove a single bundle dir. */
export function remove(sha: string, root = PREVIEW_DIR): void {
  _remove(storeAt(root), sha);
}

/**
 * Evict all but the `keep` most-recently-accessed bundles. Also sweeps dirs with
 * no valid bundle (interrupted builds) regardless of recency. Returns evicted
 * shas. `skip` (in-flight builds) are never touched.
 */
export function evictLru(keep: number = PREVIEW_STORE.keep, root = PREVIEW_DIR, skip?: Set<string>): string[] {
  return _evictLru(storeAt(root, keep), skip);
}
