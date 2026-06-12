// Preview bundle disk cache.
//
// Bundles live under PREVIEW_DIR/<sha>/ — ephemeral by design (Railway wipes
// /tmp on every restart/deploy; that's fine, everything regenerates from the
// previews table's sha→repo map). Layout per sha:
//   <sha>/atlas/      extracted content/** (build source)
//   <sha>/out/        built artifacts (docs.json, relations.json, …)
//   <sha>/meta.json   PreviewMeta (banner + interstitial)
//
// LRU: keep the 20 most-recently-accessed bundles; dir mtime is the access clock.

import fs from "node:fs";
import path from "node:path";

export const PREVIEW_DIR = process.env.PREVIEW_DIR ?? "/tmp/previews";
const KEEP = Number(process.env.PREVIEW_CACHE_KEEP ?? 20);

// Artifacts the frontend may fetch in preview mode. addresses.json + chain-state
// are deliberately NOT here — they're reused from main (per-artifact routing).
export const ARTIFACT_ALLOWLIST = new Set([
  "docs.json",
  "relations.json",
  "glossary.json",
  "search-index.json",
  "addresses.atlas.json",
  "meta.json",
  "diff.json",
  "patches.json",
]);

export interface PreviewMeta {
  sha: string;
  repo: string;
  ref: string;
  kind: "pr" | "branch" | "sha";
  prNumber?: number;
  prTitle?: string;
  prAuthor?: string;
  prState?: "open" | "merged" | "closed";
  resolvedAt: string;
  docCount: number;
  buildMs: number;
  // Trust screening: effective tier of the PR author / fork owner (absent only
  // for canonical-branch previews). forkOwner is set for fork previews only.
  trustTier?: "trusted" | "known" | "unknown";
  // Fork previews only (bare branch/sha of a non-canonical repo):
  forkOwner?: string;
  aheadBy?: number;
  behindBy?: number;
  /** Addresses in this preview's atlas not present in the live atlas. */
  newAddresses?: number;
  /** Diff recovery was bounded — markers may miss docs on very large forks. */
  diffTruncated?: boolean;
}

export interface PreviewPaths {
  dir: string;
  atlasDir: string;
  outDir: string;
  metaPath: string;
}

export function previewPaths(sha: string, root = PREVIEW_DIR): PreviewPaths {
  const dir = path.join(root, sha);
  return { dir, atlasDir: path.join(dir, "atlas"), outDir: path.join(dir, "out"), metaPath: path.join(dir, "meta.json") };
}

/** A bundle is ready when its meta + the core artifact exist. */
export function bundleReady(sha: string, root = PREVIEW_DIR): boolean {
  const p = previewPaths(sha, root);
  return fs.existsSync(p.metaPath) && fs.existsSync(path.join(p.outDir, "docs.json"));
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
  if (!ARTIFACT_ALLOWLIST.has(name)) return null;
  const p = previewPaths(sha, root);
  return name === "meta.json" ? p.metaPath : path.join(p.outDir, name);
}

/** Mark a bundle as just-accessed (LRU clock). */
export function touch(sha: string, root = PREVIEW_DIR): void {
  const dir = previewPaths(sha, root).dir;
  try {
    const now = new Date();
    fs.utimesSync(dir, now, now);
  } catch {
    /* missing dir — nothing to touch */
  }
}

/** Remove a single bundle dir. */
export function remove(sha: string, root = PREVIEW_DIR): void {
  fs.rmSync(previewPaths(sha, root).dir, { recursive: true, force: true });
}

/**
 * Evict all but the KEEP most-recently-accessed bundles. Also sweeps dirs with
 * no valid bundle (interrupted builds) regardless of recency. Returns evicted shas.
 */
export function evictLru(keep = KEEP, root = PREVIEW_DIR): string[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return [];
  }
  const dirs = entries
    .map((name) => {
      try {
        const full = path.join(root, name);
        if (!fs.statSync(full).isDirectory()) return null;
        return { sha: name, mtime: fs.statSync(full).mtimeMs, ready: bundleReady(name, root) };
      } catch {
        return null;
      }
    })
    .filter((d): d is { sha: string; mtime: number; ready: boolean } => d !== null);

  const evicted: string[] = [];
  // Drop unfinished bundles outright.
  for (const d of dirs.filter((x) => !x.ready)) {
    remove(d.sha, root);
    evicted.push(d.sha);
  }
  // Keep the newest `keep` of the ready ones; evict the rest.
  const ready = dirs.filter((x) => x.ready).sort((a, b) => b.mtime - a.mtime);
  for (const d of ready.slice(keep)) {
    remove(d.sha, root);
    evicted.push(d.sha);
  }
  return evicted;
}
