// GET /api/atlas/:sha/:name.json — immutable per-SHA live atlas artifacts.
// Dispatched from index.ts's fetch fallback (dynamic :sha/:name segments).
//
// The SHA dir is retained (within MAIN_STORE.keep), so a URL's bytes never
// change AND never vanish under the cache window → true immutability, no
// serve-if-current/409 dance. The frontend learns the current sha from the HTML
// (window.__ATLAS_SHA__) and is forced forward on a 404 (pruned old sha) — so we
// never engineer continuity for stale shas.
//
// A local miss is not automatically a 404 any more: the bundle may exist in the
// shared artifact store even though this container has never built or
// downloaded it (a cold instance, or the window between the updater swapping
// its in-memory sha and publishing that sha's bundle — docs/plans/atlas-artifact-store.md
// payoff 1). Missing artifacts are hydrated onto local disk, then served.
import { MAIN_STORE, artifactPath, hydrateBundleFromStore, serveBundleArtifact, type ArtifactFetch } from "./bundle-store.ts";

const SHA_RE = /^[0-9a-f]{40}$/i;
// Immutable: bytes are pinned to the sha. Indexable (no noindex) — unlike preview.
const IMMUTABLE: Record<string, string> = { "Cache-Control": "public, max-age=31536000, immutable" };

const NOT_FOUND = () => new Response(null, { status: 404 });

// Default fetcher: no shared artifact store wired in, so a local miss stays a
// 404 exactly as it did before this parameter existed. index.ts passes
// atlas-artifacts.ts's getArtifacts (plan phase 1) at the call site once that
// module lands; injected rather than imported so this stays testable without a
// database, matching the codebase's DI convention (TickDeps, BootDeps, SpawnFn).
const NO_ARTIFACT_STORE: ArtifactFetch = async () => [];

/** Dispatch /api/atlas/* . pathname includes the leading "/api/atlas/". */
export async function handleAtlasStatic(
  req: Request,
  pathname: string,
  fetchArtifacts: ArtifactFetch = NO_ARTIFACT_STORE,
): Promise<Response> {
  const segs = pathname.slice("/api/atlas/".length).split("/").filter(Boolean);
  if (segs.length !== 2) return NOT_FOUND();
  const [sha, name] = segs;
  if (!SHA_RE.test(sha)) return NOT_FOUND();
  const key = sha.toLowerCase();
  const hit = await serveBundleArtifact(MAIN_STORE, key, name, req, IMMUTABLE);
  if (hit) return hit;
  // Miss. A name this store would never serve can't be hydrated into existence
  // — don't spend a store round-trip on it.
  if (!artifactPath(MAIN_STORE, key, name)) return NOT_FOUND();
  if (!(await hydrateBundleFromStore(MAIN_STORE, key, fetchArtifacts))) return NOT_FOUND();
  return (await serveBundleArtifact(MAIN_STORE, key, name, req, IMMUTABLE)) ?? NOT_FOUND();
}
