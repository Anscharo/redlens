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
// hydrateBundleFromStore fills the same dir from the shared artifact store when
// a request arrives for a sha this container never built (docs/plans/atlas-artifact-store.md);
// both go through stageIntoBundle, so both land atomically.
import fs from "node:fs";
import path from "node:path";
import { gzip, gunzip } from "node:zlib";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { config } from "./config.ts";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

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
// In-flight staging dirs (`${root}\0${STAGING_PREFIX+sha}`). evictLru must not
// sweep these: hydrate of sha A finishing used to delete sha B's still-writing
// stage (and a hydrate could delete a concurrent publish's), because leftover
// `.tmp-*` dirs are otherwise treated as crash garbage. stageIntoBundle is the
// only writer of these names — publish AND hydrate both go through it — so the
// set lives here, not in each caller.
const liveStages = new Set<string>();
function stageKey(root: string, stagingName: string): string {
  return `${root}\0${stagingName}`;
}

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

/**
 * What the worker publishes to the shared artifact store for each atlas sha
 * (docs/plans/atlas-artifact-store.md phase 3) — DERIVED from MAIN_ALLOWLIST so
 * a name added to the served set can never be forgotten here.
 *
 * Plus graph.json, which MAIN deliberately does not serve: the browser never
 * fetches it, but readArtifactsFromDisk needs it to build the in-memory indexes
 * and rebuilding it (build-graph) is the expensive step phase 4 moves off the
 * web instance. Consumers take what they need — hydrateBundleFromStore filters
 * to the servable set, phase 4's refresh writes all of it to publicDir.
 *
 * docs.json is absent on purpose: nothing serves it and nothing reads main's
 * per-sha copy, and the web rebuilds the flat one from atlas_doc_meta anyway.
 */
export const PUBLISHED_ARTIFACTS: readonly string[] = [...MAIN_ALLOWLIST, "graph.json"];

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

// The live atlas sha, protected from eviction unconditionally. Null (nothing
// pinned) is the default, so an unpinned store evicts exactly as it always did.
//
// This exists because evictLru is least-recently-WRITTEN, not least-recently-
// used: nothing stamps a bundle's mtime on serve, so the live sha's clock is
// frozen at its publish time while every hydrate stamps now(). With
// ATLAS_BUNDLE_KEEP defaulting to 4 and /api/atlas/<sha>/* served as immutable
// AND indexable, a crawler walking old indexed sha URLs would hydrate four cold
// bundles and evict the live one — self-healing (the next request re-hydrates
// it) but a ~3 MB store read plus a latency spike on a real user's request, in
// a loop. Pinning fixes that without touch-on-serve, which would cost a syscall
// per request and still lose a live-but-momentarily-idle sha right after a swap.
let pinnedSha: string | null = null;

/**
 * Pin the sha eviction must never remove — the live atlas bundle. `null`
 * unpins. Set on swap and at boot by the caller that knows what "live" means
 * (atlas-updater.ts / index.ts); this module never decides it for itself.
 */
export function pinBundleSha(sha: string | null): void {
  pinnedSha = sha ? sha.toLowerCase() : null;
}

/** The currently pinned sha, or null. */
export function pinnedBundleSha(): string | null {
  return pinnedSha;
}

/**
 * Evict all but the `keep` most-recently-accessed ready bundles; also sweep
 * unfinished/interrupted dirs regardless of recency. `skip` (in-flight builds +
 * the sha being published/hydrated) and the pinned live sha are never touched.
 * Returns evicted shas.
 *
 * The pin is honoured HERE rather than by every caller passing it in `skip`,
 * so a future caller cannot forget it.
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
        // Excluded from consideration entirely (like `skip`): neither swept
        // as unready nor counted against `keep`.
        if (skip?.has(name) || name.toLowerCase() === pinnedSha) return null;
        const st = fs.statSync(path.join(store.root, name));
        if (!st.isDirectory()) return null;
        // A leftover staging dir means a publish/hydrate died mid-write —
        // always garbage, so report it unready and let the sweep below delete
        // it. Checked explicitly because a readyCore-less store would otherwise
        // see the dir exists and call it ready. Skip dirs still being written:
        // hydrate of one sha finishing must not delete another's stage, and
        // neither may delete a concurrent publish's. The writer registers in
        // liveStages (stageIntoBundle) so a future caller cannot forget this.
        if (name.startsWith(STAGING_PREFIX)) {
          if (liveStages.has(stageKey(store.root, name))) return null;
          return { sha: name, mtime: st.mtimeMs, ready: false };
        }
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

// Preview-only / handler-computed artifacts: they are allowlisted for serving
// but are never materialised by publishBundle or hydrateBundleFromStore (they
// are written by the preview build itself, and meta.json does not even live in
// the artifact subdir).
const NOT_MATERIALISED = new Set(["meta.json", "diff.json", "patches.json"]);

/** Names a bundle writer may materialise into <sha>'s artifact dir. */
function materialisable(store: BundleStore, name: string): boolean {
  return store.allowlist.has(name) && !NOT_MATERIALISED.has(name);
}

/**
 * Materialise <root>/<sha> atomically. `writeInto` fills a fresh staging
 * artifact dir and returns how many artifacts it wrote; only then is the stage
 * renamed into place, in a single step, so <root>/<sha> is never observable
 * half-written. Shared by publishBundle and hydrateBundleFromStore — both must
 * be equally atomic, so neither owns its own copy of this dance.
 *
 * Returns the count `writeInto` reported. A count of 0 renames nothing and
 * leaves no stage: with the dir itself as the readiness proof (readyCore null),
 * an empty bundle would be a sha that 404s forever with nothing downstream to
 * catch it. Callers decide what "nothing was written" means for them.
 *
 * On any throw the stage is removed, so a retry can never rename a half-filled
 * dir into place as though it were complete.
 */
async function stageIntoBundle(
  store: BundleStore,
  sha: string,
  writeInto: (dir: string) => Promise<number>,
): Promise<number> {
  const stagingName = STAGING_PREFIX + sha;
  const staging = path.join(store.root, stagingName);
  liveStages.add(stageKey(store.root, stagingName));
  try {
    // Clear any stage left by an earlier crashed attempt before reusing the path.
    fs.rmSync(staging, { recursive: true, force: true });
    const dir = artifactDirIn(store, staging);
    fs.mkdirSync(dir, { recursive: true });
    try {
      const written = await writeInto(dir);
      if (written > 0) fs.renameSync(staging, bundleDir(store, sha));
      else fs.rmSync(staging, { recursive: true, force: true });
      return written;
    } catch (e) {
      fs.rmSync(staging, { recursive: true, force: true });
      throw e;
    }
  } finally {
    liveStages.delete(stageKey(store.root, stagingName));
  }
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
    const copied = await stageIntoBundle(store, sha, async (dir) => {
      let n = 0;
      for (const name of store.allowlist) {
        // Skip preview-only/computed artifacts; publishBundle only mirrors built flat files.
        if (!materialisable(store, name)) continue;
        const src = path.join(srcDir, name);
        if (!fs.existsSync(src)) continue;
        const buf = fs.readFileSync(src);
        fs.writeFileSync(path.join(dir, name), buf);
        fs.writeFileSync(path.join(dir, name + ".gz"), await gzipAsync(buf, { level: 9 }));
        n++;
      }
      return n;
    });
    // Refuse to publish an empty bundle. Before the atomic rename, a srcDir with
    // no artifacts produced a dir that bundleReady rejected (no core file) and
    // evictLru then swept; now that the dir IS the readiness proof, nothing
    // downstream would catch it and every request for this sha would 404
    // forever. stageIntoBundle already declined to rename anything into place;
    // throwing parks the sha in the updater's pendingPublishSha for a retry
    // instead of silently reporting success.
    if (copied === 0) throw new Error(`publishBundle: no artifacts found in ${srcDir}`);
  }
  touch(store, sha);
  evictLru(store, new Set([sha]));
}

/**
 * Fetch one sha's published artifacts as gzipped blobs, or [] when that sha was
 * never published (or has been pruned). Injected rather than imported so the
 * hydrate path is testable without a database — see docs/plans/atlas-artifact-store.md.
 */
export type ArtifactFetch = (
  sha: string,
  names?: readonly string[],
) => Promise<Array<{ name: string; gz: Buffer; sha256?: string; rawBytes?: number }>>;

/**
 * Refuse a blob whose bytes are not what the publisher recorded. Gzip's own CRC
 * only proves the container survived; it says nothing about a row that was
 * written from the wrong source or truncated before compression. Without this a
 * corrupt-but-gunzippable artifact would be cached as a COMPLETE bundle, and
 * the existsSync short-circuit at the top of hydrateBundleFromStore would then
 * serve it forever without ever re-fetching. Throwing unwinds the stage.
 *
 * Both fields are optional on the fetch contract, so an injected fetcher that
 * cannot supply them still works — it just gets no verification.
 */
function verifyArtifact(a: { name: string; sha256?: string; rawBytes?: number }, raw: Buffer): void {
  if (a.rawBytes !== undefined && raw.byteLength !== a.rawBytes) {
    throw new Error(`${a.name}: ${raw.byteLength} bytes, expected ${a.rawBytes}`);
  }
  if (a.sha256 && createHash("sha256").update(raw).digest("hex") !== a.sha256) {
    throw new Error(`${a.name}: sha256 mismatch`);
  }
}

// De-dupes concurrent hydrates of the same bundle: a cold instance can take a
// burst of requests for one sha (every artifact of one page load, plus every
// other viewer) and must download the set ONCE, not once per request. Keyed by
// root+sha so two stores can't collide. Same shape as credits.ts's `inflight`,
// per key like preview/build.ts's Map.
const hydrating = new Map<string, Promise<boolean>>();

/**
 * Materialise <root>/<sha> from the shared artifact store on a local miss:
 * download the sha's blobs, write each one as BOTH the flat .json (gunzipped)
 * and its .gz sibling — serveBundleArtifact prefers the .gz for gzip-accepting
 * clients, so a flat-only hydrate would silently drop compression — then touch
 * + prune exactly like a publish.
 *
 * Resolves false when nothing was written: a genuinely pruned/unknown sha (the
 * caller 404s, as it did before this path existed). Failures — a store read
 * that throws, corrupt blobs, a full disk — also resolve false rather than
 * reject: this runs under a static-artifact GET whose honest answer on "I
 * cannot produce these bytes" is 404, and a DB blip must not become a 500.
 * They are warned about, so they stay visible in the logs.
 *
 * Uses publishBundle's staging + rename, so a hydrate is exactly as atomic: no
 * request can ever see a half-downloaded bundle dir.
 */
export function hydrateBundleFromStore(store: BundleStore, sha: string, fetch: ArtifactFetch): Promise<boolean> {
  // Already materialised locally (published by this instance, or hydrated by an
  // earlier request) — never re-download, and never try to rename a stage over
  // a dir that already exists.
  if (fs.existsSync(bundleDir(store, sha))) return Promise.resolve(bundleReady(store, sha));
  const key = `${store.root}\0${sha}`;
  const existing = hydrating.get(key);
  if (existing) return existing;
  const p = runHydrate(store, sha, fetch).finally(() => hydrating.delete(key));
  hydrating.set(key, p);
  return p;
}

async function runHydrate(store: BundleStore, sha: string, fetch: ArtifactFetch): Promise<boolean> {
  try {
    // Honour the allowlist: never write a file this store would refuse to serve
    // (an unservable file in the bundle is dead weight at best, and for a store
    // whose dir existence IS its readiness proof, a bundle of nothing else is a
    // permanently-404ing sha).
    // Ask for only what this store can serve. The shared store holds the union
    // of every consumer's needs (graph.json included, for phase 4's refresh),
    // and downloading a ~0.64 MB blob per cold miss just to drop it here is
    // waste that scales with the number of cold instances. The post-filter
    // stays: an injected fetcher is free to ignore `names`.
    const wanted = [...store.allowlist].filter((n) => materialisable(store, n));
    const items = (await fetch(sha, wanted)).filter((a) => materialisable(store, a.name));
    if (items.length === 0) return false;
    const written = await stageIntoBundle(store, sha, async (dir) => {
      for (const a of items) {
        const raw = await gunzipAsync(a.gz);
        verifyArtifact(a, raw);
        fs.writeFileSync(path.join(dir, a.name), raw);
        fs.writeFileSync(path.join(dir, a.name + ".gz"), a.gz);
      }
      return items.length;
    });
    if (written === 0) return false;
  } catch (e) {
    console.warn(`[bundle-store] hydrate ${sha.slice(0, 8)} failed: ${(e as Error).message}`);
    return false;
  }
  touch(store, sha);
  evictLru(store, new Set([sha]));
  return true;
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
