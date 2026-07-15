// Live-atlas data-source plumbing (main-thread). The server injects the current
// atlas sha into the HTML (window.__ATLAS_SHA__, no-cache so it's always fresh);
// live artifacts are served from the immutable per-sha path
// /api/atlas/<sha>/<name>.json so a URL's bytes never change. This is the DEFAULT
// base for every loader; previews pass their own "/api/preview/<sha>/" base
// explicitly via the DataSource context.
import { StaleAtlasError } from "./verify";

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
// pruned; reload once — the fresh no-cache HTML carries the new sha and the app
// re-fetches the new immutable URLs. We deliberately never serve a stale sha or
// build lazy-old-artifact fallback.
let reloading = false;
function reloadOnce(): void {
  if (reloading || typeof window === "undefined") return;
  reloading = true;
  window.location.reload();
}

/** True (and reloads) if `err` is a StaleAtlasError — for main-thread .catch handlers. */
export function handledStale(err: unknown): boolean {
  if (err instanceof StaleAtlasError || (err instanceof Error && err.name === "StaleAtlasError")) {
    reloadOnce();
    return true;
  }
  return false;
}

/** True (and reloads) if a worker-posted error string is a stale-sha signal. */
export function handledStaleMessage(message: string): boolean {
  if (message.includes("StaleAtlasError")) {
    reloadOnce();
    return true;
  }
  return false;
}
