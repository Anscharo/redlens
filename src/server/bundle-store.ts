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
  /**
   * Artifact whose presence proves the bundle is complete, for stores whose
   * dir is filled IN PLACE (previews spawn the build straight into <sha>/out).
   * `null` for a store published atomically by publishBundle below: the dir is
   * renamed into place only after every artifact is written, so its existence
   * is the proof and no single file has to stand in for the whole set.
   */
  readyCore: string | null;
  /** Readiness also requires <sha>/meta.json (preview bundles). */
  requireMeta: boolean;
}

// Staging-dir prefix for publishBundle's atomic rename. Leading dot + a prefix
// no sha can have (shas are hex), so evictLru can recognise a leftover stage
// from a crashed publish and never mistake one for a bundle.
const STAGING_PREFIX = ".tmp-";

// NOT routed through config.ts: preview/handler.test.ts sets
// process.env.PREVIEW_DIR at its OWN top level (before config.ts, which is
// imported far earlier by nearly every other server test file, would have any
// chance to re-observe it) and relies on THIS module's own first-import timing
// to pick up the override. Going through config.ts would freeze the value at
// config.ts's own (much earlier) first import instead.
export const PREVIEW_DIR = process.env.PREVIEW_DIR ?? "/tmp/previews";

// Atlas-derived artifacts only. On-chain data is shared, not atlas-versioned, so
// it stays outside this store and preview reuses main's: addresses.json is flat
// under BASE_URL, and the contract-state snapshot is served from /api/chain-state
// (a Postgres row, not a file — migration 020).
// docs.json is deliberately NOT bundled here. The browser fetches
// docs-shallow.json (depth ≤ 5, first paint) + docs-deep.json (depth > 5,
// background) instead — see docs/plans/docs-split.md — nothing reads main's
// per-sha copy off disk, and the server's own indexes read the flat
// public/docs.json. It used to be carried solely as the bundleReady core, which
// cost a 6 MB write plus a gzip -9 over 6 MB on every publish for a file no
// request could reach, and (being FIRST in this set) marked the bundle ready
// after 1 of 8 files. The atomic publish below removes the need for a core
// marker entirely. PREVIEW still bundles it — the preview differ reads
// <sha>/out/docs.json (preview/build.ts snapshotFromDocsJson).
// Report views that join against the atlas graph stay sha-keyed here too.
const MAIN_ALLOWLIST = new Set([
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
  // Published atomically (stage → rename), so the dir's existence is readiness.
  readyCore: null,
  requireMeta: false,
};

export const PREVIEW_STORE: BundleStore = {
  root: PREVIEW_DIR,
  artifactSubdir: "out",
  keep: config.previewCacheKeep,
  allowlist: PREVIEW_ALLOWLIST,
  // Filled in place by the preview build (not publishBundle), so completeness
  // needs a real marker: docs.json is the build's core output and writeMeta()
  // lands meta.json last (preview/build.ts).
  readyCore: "docs.json",
  requireMeta: true,
};

export function bundleDir(store: BundleStore, sha: string): string {
  return path.join(store.root, sha);
}

/** Where artifacts live inside a given bundle dir ("" → the dir itself). */
function artifactDirIn(store: BundleStore, dir: string): string {
  return store.artifactSubdir ? path.join(dir, store.artifactSubdir) : dir;
}

function artifactDir(store: BundleStore, sha: string): string {
  return artifactDirIn(store, bundleDir(store, sha));
}

/** Resolve an allowlisted artifact's absolute path, or null if not allowed. */
export function artifactPath(store: BundleStore, sha: string, name: string): string | null {
  if (!store.allowlist.has(name)) return null;
  // meta.json (preview) lives at the bundle root, not in the artifact subdir.
  if (name === "meta.json") return path.join(store.root, sha, "meta.json");
  return path.join(artifactDir(store, sha), name);
}

/** A bundle is ready when it is complete on disk — see BundleStore.readyCore
 *  for why that is a named artifact for some stores and the dir itself for
 *  others (+ meta.json, for preview). */
export function bundleReady(store: BundleStore, sha: string): boolean {
  if (store.readyCore) {
    const core = artifactPath(store, sha, store.readyCore);
    if (!core || !fs.existsSync(core)) return false;
  } else if (!fs.existsSync(bundleDir(store, sha))) {
    return false;
  }
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
        // A leftover staging dir means a publish died mid-write — always
        // garbage, so report it unready and let the sweep below delete it.
        // Checked explicitly because a readyCore-less store would otherwise
        // see the dir exists and call it ready. publishBundle renames its
        // stage away BEFORE calling evictLru, and it is the only writer of
        // these (never concurrent with itself), so this cannot race a live one.
        if (name.startsWith(STAGING_PREFIX)) return { sha: name, mtime: st.mtimeMs, ready: false };
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
 * Publish freshly-built FLAT artifacts from `srcDir` as the immutable bundle
 * <root>/<sha>/, generating a fresh .gz beside each, then prune (keeping `sha`
 * itself). Used by the build-time publish (build-bundle.ts) and the runtime
 * updater after it has regenerated all flat artifacts in public/
 * (search-index.json included).
 *
 * ATOMIC: artifacts are written into a staging dir that is renamed into place
 * in a single step, so <root>/<sha> is never observable half-written. This is
 * load-bearing, not tidiness: the serve path (serveBundleArtifact) checks
 * individual files and never consults bundleReady, and the updater swaps its
 * in-memory indexes — and therefore the sha it injects as window.__ATLAS_SHA__
 * — BEFORE calling this. A page load in between would otherwise request an
 * artifact that was about to exist, get a 404, and be force-reloaded as if the
 * sha had been pruned (apps/web/src/lib/atlasBase.ts).
 *
 * IDEMPOTENT: a bundle's bytes are fixed by its sha, so an already-published
 * sha is left alone — its LRU clock is refreshed and pruning still runs —
 * rather than rewritten byte-for-byte.
 */
export async function publishBundle(store: BundleStore, sha: string, srcDir: string): Promise<void> {
  if (!fs.existsSync(bundleDir(store, sha))) {
    const staging = path.join(store.root, STAGING_PREFIX + sha);
    // Clear any stage left by an earlier crashed attempt before reusing the path.
    fs.rmSync(staging, { recursive: true, force: true });
    const dir = artifactDirIn(store, staging);
    fs.mkdirSync(dir, { recursive: true });
    try {
      let copied = 0;
      for (const name of store.allowlist) {
        // Skip preview-only/computed artifacts; publishBundle only mirrors built flat files.
        if (name === "meta.json" || name === "diff.json" || name === "patches.json") continue;
        const src = path.join(srcDir, name);
        if (!fs.existsSync(src)) continue;
        const buf = fs.readFileSync(src);
        fs.writeFileSync(path.join(dir, name), buf);
        fs.writeFileSync(path.join(dir, name + ".gz"), await gzipAsync(buf, { level: 9 }));
        copied++;
      }
      // Refuse to publish an empty bundle. Before the atomic rename below, a
      // srcDir with no artifacts produced a dir that bundleReady rejected (no
      // core file) and evictLru then swept; now that the dir IS the readiness
      // proof, nothing downstream would catch it and every request for this sha
      // would 404 forever. Throwing parks the sha in the updater's
      // pendingPublishSha for a retry instead of silently serving nothing.
      if (copied === 0) throw new Error(`publishBundle: no artifacts found in ${srcDir}`);
      fs.renameSync(staging, bundleDir(store, sha));
    } catch (e) {
      // Never leave a partial stage behind: the updater's pendingPublishSha
      // retry re-enters here, and a half-filled stage must not be renamed into
      // place as though it were complete.
      fs.rmSync(staging, { recursive: true, force: true });
      throw e;
    }
  }
  touch(store, sha);
  evictLru(store, new Set([sha]));
}

/**
 * Serve an allowlisted artifact with pre-compressed .gz negotiation. Returns a
 * Response, or null if the name isn't allowlisted / the file is missing (caller
 * decides the 404 shape). `extraHeaders` carry the per-namespace cache policy.
 */
/** Extension → Content-Type for served artifacts. Shared with the static
 *  handler in index.ts so the two serving paths can't drift. */
export function contentTypeFor(name: string): string {
  return name.endsWith(".json")
    ? "application/json"
    : name.endsWith(".js")
      ? "application/javascript"
      : name.endsWith(".css")
        ? "text/css"
        : "application/octet-stream";
}

export async function serveBundleArtifact(
  store: BundleStore,
  sha: string,
  name: string,
  req: Request,
  extraHeaders: Record<string, string> = {},
): Promise<Response | null> {
  const p = artifactPath(store, sha, name);
  if (!p) return null;
  const mime = contentTypeFor(name);
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
