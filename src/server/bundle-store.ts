// Generalized per-SHA bundle store — the shared mechanism behind BOTH the live
// atlas and previews. A bundle is one immutable directory of built artifacts
// keyed by atlas sha; its URL's bytes never change and (within retention) never
// disappear, so it caches forever and freshness becomes "fetch a different URL".
//
// Two instances differ only by config:
//   MAIN_STORE    live atlas — flat <root>/<sha>/<name>.json, keep a few
//   PREVIEW_STORE previews   — <root>/<sha>/out/<name>.json + <sha>/meta.json,
//                              keep 20 (preview/cache.ts wraps this instance)
//
// publishBundle copies freshly-built FLAT artifacts into a per-SHA dir and
// (re)generates their .gz siblings from the fresh bytes — fixing the latent bug
// where the runtime updater overwrote flat *.json but left stale *.gz behind.
import fs from "node:fs";
import path from "node:path";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { config } from "./config.ts";

const gzipAsync = promisify(gzip);

export interface BundleStore {
  /** Directory holding the per-sha bundle dirs. */
  root: string;
  /** Subdir inside <root>/<sha> where artifacts live ("" → flat; "out" → preview). */
  artifactSubdir: string;
  /** LRU retention count. */
  keep: number;
  /** Artifact names the store will resolve/serve. */
  allowlist: Set<string>;
  /** Readiness also requires <sha>/meta.json (preview bundles). */
  requireMeta: boolean;
}

export const PREVIEW_DIR = process.env.PREVIEW_DIR ?? "/tmp/previews";

// Atlas-derived artifacts only. addresses.json + chain-state.json are on-chain /
// shared (not atlas-versioned) and stay flat under BASE_URL; preview reuses main's.
// docs.json stays bundled as the bundleReady core + diff source; the browser
// fetches docs-shallow.json (depth ≤ 5, first paint) + docs-deep.json (depth > 5,
// background) instead — see docs/plans/docs-split.md. Report views that join
// against the atlas graph stay sha-keyed here too.
const MAIN_ALLOWLIST = new Set([
  "docs.json",
  "docs-shallow.json",
  "docs-deep.json",
  "search-index.json",
  "relations.json",
  "glossary.json",
  "oea-report.json",
  "addresses.atlas.json",
]);

// Preview artifacts. meta.json/diff.json/patches.json are preview-only and live
// at the bundle root or are computed by the handler — publishBundle skips them.
const PREVIEW_ALLOWLIST = new Set([
  "docs.json",
  "docs-shallow.json",
  "docs-deep.json",
  "relations.json",
  "glossary.json",
  "search-index.json",
  "addresses.atlas.json",
  "meta.json",
  "diff.json",
  "patches.json",
]);

export const MAIN_STORE: BundleStore = {
  root: config.atlasBundleRoot,
  artifactSubdir: "",
  keep: config.atlasBundleKeep,
  allowlist: MAIN_ALLOWLIST,
  requireMeta: false,
};

export const PREVIEW_STORE: BundleStore = {
  root: PREVIEW_DIR,
  artifactSubdir: "out",
  keep: Number(process.env.PREVIEW_CACHE_KEEP ?? 20),
  allowlist: PREVIEW_ALLOWLIST,
  requireMeta: true,
};

export function bundleDir(store: BundleStore, sha: string): string {
  return path.join(store.root, sha);
}

function artifactDir(store: BundleStore, sha: string): string {
  return store.artifactSubdir ? path.join(store.root, sha, store.artifactSubdir) : path.join(store.root, sha);
}

/** Resolve an allowlisted artifact's absolute path, or null if not allowed. */
export function artifactPath(store: BundleStore, sha: string, name: string): string | null {
  if (!store.allowlist.has(name)) return null;
  // meta.json (preview) lives at the bundle root, not in the artifact subdir.
  if (name === "meta.json") return path.join(store.root, sha, "meta.json");
  return path.join(artifactDir(store, sha), name);
}

/** A bundle is ready when its core artifact (+ meta, for preview) exists. */
export function bundleReady(store: BundleStore, sha: string): boolean {
  const core = artifactPath(store, sha, "docs.json");
  if (!core || !fs.existsSync(core)) return false;
  if (store.requireMeta && !fs.existsSync(path.join(store.root, sha, "meta.json"))) return false;
  return true;
}

/** Mark a bundle just-accessed (dir mtime is the LRU clock). */
export function touch(store: BundleStore, sha: string): void {
  try {
    const now = new Date();
    fs.utimesSync(bundleDir(store, sha), now, now);
  } catch {
    /* missing dir — nothing to touch */
  }
}

/** Remove one bundle dir. */
export function remove(store: BundleStore, sha: string): void {
  fs.rmSync(bundleDir(store, sha), { recursive: true, force: true });
}

/**
 * Evict all but the `keep` most-recently-accessed ready bundles; also sweep
 * unfinished/interrupted dirs regardless of recency. `skip` (in-flight builds +
 * the current live sha) is never touched. Returns evicted shas.
 */
export function evictLru(store: BundleStore, skip?: Set<string>): string[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(store.root);
  } catch {
    return [];
  }
  const dirs = entries
    .map((name) => {
      try {
        if (skip?.has(name)) return null;
        const st = fs.statSync(path.join(store.root, name));
        if (!st.isDirectory()) return null;
        return { sha: name, mtime: st.mtimeMs, ready: bundleReady(store, name) };
      } catch {
        return null;
      }
    })
    .filter((d): d is { sha: string; mtime: number; ready: boolean } => d !== null);

  const evicted: string[] = [];
  for (const d of dirs.filter((x) => !x.ready)) {
    remove(store, d.sha);
    evicted.push(d.sha);
  }
  const ready = dirs.filter((x) => x.ready).sort((a, b) => b.mtime - a.mtime);
  for (const d of ready.slice(store.keep)) {
    remove(store, d.sha);
    evicted.push(d.sha);
  }
  return evicted;
}

/**
 * Copy freshly-built FLAT artifacts from `srcDir` into <root>/<sha>/, generating
 * a fresh .gz beside each, then prune (keeping `sha` itself). Idempotent. Used by
 * the build-time publish (build-bundle.ts) and the runtime updater after it has
 * regenerated all flat artifacts in public/ (search-index.json included).
 */
export async function publishBundle(store: BundleStore, sha: string, srcDir: string): Promise<void> {
  const dir = artifactDir(store, sha);
  fs.mkdirSync(dir, { recursive: true });
  for (const name of store.allowlist) {
    // Skip preview-only/computed artifacts; publishBundle only mirrors built flat files.
    if (name === "meta.json" || name === "diff.json" || name === "patches.json") continue;
    const src = path.join(srcDir, name);
    if (!fs.existsSync(src)) continue;
    const buf = fs.readFileSync(src);
    fs.writeFileSync(path.join(dir, name), buf);
    fs.writeFileSync(path.join(dir, name + ".gz"), await gzipAsync(buf, { level: 9 }));
  }
  touch(store, sha);
  evictLru(store, new Set([sha]));
}

/**
 * Serve an allowlisted artifact with pre-compressed .gz negotiation. Returns a
 * Response, or null if the name isn't allowlisted / the file is missing (caller
 * decides the 404 shape). `extraHeaders` carry the per-namespace cache policy.
 */
export async function serveBundleArtifact(
  store: BundleStore,
  sha: string,
  name: string,
  req: Request,
  extraHeaders: Record<string, string> = {},
): Promise<Response | null> {
  const p = artifactPath(store, sha, name);
  if (!p) return null;
  const mime = name.endsWith(".json")
    ? "application/json"
    : name.endsWith(".js")
      ? "application/javascript"
      : name.endsWith(".css")
        ? "text/css"
        : "application/octet-stream";
  if (req.headers.get("accept-encoding")?.includes("gzip")) {
    const gz = Bun.file(p + ".gz");
    if (await gz.exists()) {
      return new Response(gz, {
        headers: { "Content-Encoding": "gzip", "Content-Type": mime, Vary: "Accept-Encoding", ...extraHeaders },
      });
    }
  }
  const file = Bun.file(p);
  if (!(await file.exists())) return null;
  return new Response(file, { headers: { "Content-Type": mime, ...extraHeaders } });
}
