// Stale-chunk (deploy drift) detection. Every deploy replaces the hashed
// /assets/*.js chunks wholesale; a tab opened before the deploy that
// lazy-imports a chunk gets a 404 and import() rejects (Chrome: "Failed to
// fetch dynamically imported module", Firefox: "error loading dynamically
// imported module", Safari: "Importing a module script failed"). A refresh
// always fixes it — the no-cache HTML shell references the new hashes.
//
// Deliberately NO auto-reload: a page that reloads itself mid-session is
// jarring. The ErrorBoundary fallbacks detect the case via isStaleChunkError
// and show "a new version of the app is available" with a refresh button —
// the user decides. (Mirrors the useSWUpdate mid-session pill philosophy.)

// "Unable to preload CSS" is Vite's preload-helper error for a lazy chunk's
// stylesheet dep — hashed like the JS, so it goes stale the same way.
const STALE_CHUNK_RE =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Failed to load module script|Unable to preload CSS/i;

export function isStaleChunkError(err: unknown): boolean {
  return err instanceof Error && STALE_CHUNK_RE.test(err.message);
}

// Seam for tests: jsdom's window.location.reload is [LegacyUnforgeable] and
// cannot be spied on, so the refresh buttons reload through here.
export const pageReloader = {
  reload: (): void => window.location.reload(),
};
