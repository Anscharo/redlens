// Live-atlas data-source plumbing (main-thread). The server injects the current
// atlas sha into the HTML (window.__ATLAS_SHA__, no-cache so it's always fresh);
// live artifacts are served from the immutable per-sha path
// /api/atlas/<sha>/<name>.json so a URL's bytes never change. This is the DEFAULT
// base for every loader; previews pass their own "/api/preview/<sha>/" base
// explicitly via the DataSource context.
import { StaleAtlasError } from "./verify";
import { track } from "./analytics";

// A valid injected sha is a 40-hex git commit. Anything else — empty (cold boot /
// dev without injection) or the literal "{{ATLAS_SHA}}" placeholder (a stale,
// service-worker-cached shell that escaped the Bun injection) — falls back to flat
// BASE_URL. Without this guard, "{{ATLAS_SHA}}" is truthy and builds
// /api/atlas/{{ATLAS_SHA}}/…, which 404s as a StaleAtlasError and force-forwards
// on every load → an infinite reload loop. (The SW no longer precaches index.html,
// so the placeholder shouldn't reach here; this is defense-in-depth.)

const SHA_RE = /^[0-9a-f]{40}$/i;

/** The live atlas base. Invalid/absent sha → flat BASE_URL. */
export function liveAtlasBase(): string {
  const sha = typeof window !== "undefined" ? window.__ATLAS_SHA__ : undefined;
  return sha && SHA_RE.test(sha) ? `/api/atlas/${sha}/` : import.meta.env.BASE_URL;
}

/** The validated live atlas sha, or null when absent/invalid (dev, cold boot). */
export function liveAtlasSha(): string | null {
  const sha = typeof window !== "undefined" ? window.__ATLAS_SHA__ : undefined;
  return sha && SHA_RE.test(sha) ? sha : null;
}

// Force-forward on a stale sha. A 404 on a sha-keyed URL means the pinned sha was
// pruned; reload — after a short settle delay — so the fresh no-cache HTML carries
// the new sha and the app re-fetches the new immutable URLs. We deliberately never
// serve a stale sha or build lazy-old-artifact fallback.
//
// The delay exists because a deploy rollout has an overlap window: a brand-new
// page can be pinned to the new sha while its artifact request still lands on an
// old container that doesn't have it yet (404 → StaleAtlasError). Reloading
// instantly frequently re-lands the retry on that same draining old container —
// the user gets slammed onto the old build about a second after seeing the new
// one. Waiting ~2s lets the rollout settle before we ask again, and a
// sessionStorage counter caps forced reloads at 3 per rolling 60s: a real broken
// deploy (not a rollout blip) shouldn't loop forever, so past that budget we stop
// reloading and let the error surface through the caller's normal (non-reload)
// path instead.

const FORCED_RELOAD_SHA_KEY = "rl-forced-reload-from";
const FORCED_RELOAD_COUNT_KEY = "rl-forced-reload-count";
const RELOAD_LOOP_WINDOW_MS = 60_000;
const RELOAD_LOOP_MAX = 3; // up to 3 forced reloads per rolling window; the 4th+ let the error surface
const RELOAD_DELAY_MS = 2_000;
const PROBE_TIMEOUT_MS = 1_500;

// Bumps a sessionStorage-persisted {n, t} counter and reports whether we're still
// inside the reload budget. sessionStorage (unlike the module-level `reloading`
// flag below) survives the reload we're about to trigger, so it's the only way to
// detect a reload ricochet across page loads, not just within one. Fails open
// (never blocks a reload) if sessionStorage is unavailable — a broken loop guard
// should never be the reason staleness can't recover.
function withinReloadBudget(): boolean {
  try {
    const now = Date.now();
    const raw = sessionStorage.getItem(FORCED_RELOAD_COUNT_KEY);
    const prev = raw ? (JSON.parse(raw) as { n: number; t: number }) : null;
    let n = 1;
    let t = now;
    if (prev && now - prev.t < RELOAD_LOOP_WINDOW_MS) {
      n = prev.n + 1;
      t = prev.t;
    }
    sessionStorage.setItem(FORCED_RELOAD_COUNT_KEY, JSON.stringify({ n, t }));
    return n <= RELOAD_LOOP_MAX;
  } catch {
    return true;
  }
}

// Only one reload is ever scheduled per page: `reloading` gates re-entry, and
// `reloadDecision` caches the verdict so concurrent stale errors from different
// loaders (glossary/addresses/graph/docs can all fail around the same moment)
// see the same outcome instead of each re-running the budget check and double
// counting it.
let reloading = false;
let reloadDecision = true;

function reloadOnce(detail: { url: string } | { message: string }): boolean {
  // No page to reload (SSR / non-jsdom tests) — nothing to schedule. Treat as
  // handled so callers keep their existing no-op contract (they swallow the
  // error into a never-settling promise on the assumption a reload is imminent).
  if (typeof window === "undefined") return true;
  if (reloading) return reloadDecision;
  reloading = true;

  try {
    sessionStorage.setItem(FORCED_RELOAD_SHA_KEY, liveAtlasSha() ?? "invalid");
  } catch {
    // Best-effort marker for whoever reads it post-reload; never block on it.
  }

  reloadDecision = withinReloadBudget();
  track("atlas_stale_reload", {
    ...("url" in detail ? { url: detail.url } : { message: detail.message.slice(0, 120) }),
    reloaded: reloadDecision,
  });
  if (!reloadDecision) return false;

  setTimeout(() => {
    const url = "url" in detail ? detail.url : undefined;
    if (!url) {
      window.location.reload();
      return;
    }
    // Race the probe against a hard timeout so the reload never depends on a
    // container that's mid-drain actually answering — a hung HEAD would
    // otherwise turn a transient 404 into a page stuck "about to reload"
    // forever. The probe result is diagnostic only; we reload regardless.
    const probe = fetch(url, { method: "HEAD" }).then(
      (res) => res.ok,
      () => false,
    );
    const timeout = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), PROBE_TIMEOUT_MS));
    Promise.race([probe, timeout]).then((ok) => {
      track("atlas_stale_reload_probe", { url, ok });
      window.location.reload();
    });
  }, RELOAD_DELAY_MS);

  return true;
}

/** True (and reloads, after a short settle delay) if `err` is a StaleAtlasError —
 *  for main-thread .catch handlers. Returns false without reloading once this
 *  session has already forced RELOAD_LOOP_MAX reloads in the last minute, so the
 *  error can surface through the caller's normal (non-reload) path instead. */
export function handledStale(err: unknown): boolean {
  if (err instanceof StaleAtlasError) return reloadOnce({ url: err.url });
  if (err instanceof Error && err.name === "StaleAtlasError") return reloadOnce({ message: err.message });
  return false;
}

/** True (and reloads, after a short settle delay) if a worker-posted error string
 *  is a stale-sha signal. Same reload-budget fallback as handledStale — see there. */
export function handledStaleMessage(message: string): boolean {
  if (!message.includes("StaleAtlasError")) return false;
  return reloadOnce({ message });
}
