// GET /api/atlas/:sha/:name.json — immutable per-SHA live atlas artifacts.
// Dispatched from index.ts's fetch fallback (dynamic :sha/:name segments).
//
// The SHA dir is retained (within MAIN_STORE.keep), so a URL's bytes never
// change AND never vanish under the cache window → true immutability, no
// serve-if-current/409 dance. The frontend learns the current sha from the HTML
// (window.__ATLAS_SHA__) and is forced forward on a 404 (pruned old sha) — so we
// never engineer continuity for stale shas.
import { MAIN_STORE, serveBundleArtifact } from "./bundle-store.ts";

const SHA_RE = /^[0-9a-f]{40}$/i;
// Immutable: bytes are pinned to the sha. Indexable (no noindex) — unlike preview.
const IMMUTABLE: Record<string, string> = { "Cache-Control": "public, max-age=31536000, immutable" };

const NOT_FOUND = () => new Response(null, { status: 404 });

/** Dispatch /api/atlas/* . pathname includes the leading "/api/atlas/". */
export async function handleAtlasStatic(req: Request, pathname: string): Promise<Response> {
  const segs = pathname.slice("/api/atlas/".length).split("/").filter(Boolean);
  if (segs.length !== 2) return NOT_FOUND();
  const [sha, name] = segs;
  if (!SHA_RE.test(sha)) return NOT_FOUND();
  const res = await serveBundleArtifact(MAIN_STORE, sha.toLowerCase(), name, req, IMMUTABLE);
  return res ?? NOT_FOUND();
}
