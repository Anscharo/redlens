// Stale-chunk (deploy drift) handling. Every deploy replaces the hashed
// /assets/*.js chunks wholesale; a tab opened before the deploy that
// lazy-imports a chunk gets a 404 and import() rejects (Chrome: "Failed to
// fetch dynamically imported module", Firefox: "error loading dynamically
// imported module", Safari: "Importing a module script failed"). A refresh
// always fixes it — the no-cache HTML shell references the new hashes — so
// this mirrors the stale-sha data-artifact policy in atlasBase.ts: reload
// once, transparently, instead of stranding the user on "failed to render".

// "Unable to preload CSS" is Vite's preload-helper error for a lazy chunk's
// stylesheet dep — hashed like the JS, so it goes stale the same way.
const STALE_CHUNK_RE =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Failed to load module script|Unable to preload CSS/i;

export function isStaleChunkError(err: unknown): boolean {
  return err instanceof Error && STALE_CHUNK_RE.test(err.message);
}

// Reload at most once per minute per tab. The stamp lives in sessionStorage
// because a module-level flag wouldn't survive the reload — if the fresh page
// ALSO can't fetch its chunks (server truly down, not deploy drift) the guard
// blocks the second reload and the error surfaces in the boundary fallback
// instead of an infinite reload loop.
const RELOAD_STAMP_KEY = "redline-sky-atlas:stale-chunk-reload";
const RELOAD_COOLDOWN_MS = 60_000;

// Seam for tests: jsdom's window.location.reload is [LegacyUnforgeable] and
// cannot be spied on, so every stale-chunk reload goes through here.
export const pageReloader = {
  reload: (): void => window.location.reload(),
};

/** Reload the page to pick up the freshly deployed chunk hashes. Returns false
 *  (and does nothing) inside the cooldown window or when sessionStorage is
 *  unavailable (no storage → no loop guard → never auto-reload). */
export function reloadForStaleChunk(): boolean {
  // Offline, a chunk 404 isn't deploy drift and a reload would land on the
  // browser's offline page (there's no offline shell) — keep the fallback UI.
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  try {
    const last = Number(sessionStorage.getItem(RELOAD_STAMP_KEY) ?? "0");
    if (Date.now() - last < RELOAD_COOLDOWN_MS) return false;
    sessionStorage.setItem(RELOAD_STAMP_KEY, String(Date.now()));
  } catch {
    return false;
  }
  pageReloader.reload();
  return true;
}

/** Global hook: Vite dispatches `vite:preloadError` when a dynamic import (or
 *  one of its preloaded deps) fails. For stale-chunk payloads ONLY — a module
 *  evaluation error also lands here and must surface, not reload — reload
 *  before the rejection ever reaches React; preventDefault() stops Vite from
 *  rethrowing while the reload is in flight. When the guard blocks, the error
 *  propagates to the nearest ErrorBoundary, whose fallback renders the
 *  refresh prompt. */
export function installStaleChunkReload(): void {
  window.addEventListener("vite:preloadError", (event) => {
    if (isStaleChunkError(event.payload) && reloadForStaleChunk()) event.preventDefault();
  });
}
