// The access gate for every sha-keyed preview response (diff.json, bundle
// artifacts, commit history). A sha-keyed URL is not a secret, so whether a
// bundle may be served is decided here from its meta.json, never from the URL.

import { json, PREVIEW_CORS } from "../http.ts";
import { authorizePreviewAccess } from "./access.ts";
import { bundleReady, readMeta, type PreviewMeta } from "./cache.ts";

// Private-preview responses: NO access-control-allow-origin — a shared
// CDN/proxy must not cache one user's private docs for the next visitor (G6).
export const PRIVATE_HEADERS = { "cache-control": "private, no-store", "x-robots-tag": "noindex" };

export type ShaGate = { ok: true; headers: Record<string, string>; meta: PreviewMeta } | { deny: Response };

// Resolve serveability + privacy for a sha-keyed response. Gating on bundleReady
// FIRST is load-bearing (G1): artifact files exist on disk before meta.json is
// written, so "no meta yet" MUST read as not-serveable, never as public.
export async function gateSha(req: Request, sha: string): Promise<ShaGate> {
  if (!bundleReady(sha)) return { deny: json({ error: "not-found" }, 404, { headers: PREVIEW_CORS }) };
  const meta = readMeta(sha);
  // bundleReady passed (docs.json + meta.json exist on disk) but the meta didn't
  // parse — a torn/corrupt meta.json. We cannot confirm this bundle is public, so
  // fail closed: serving it with public CORS would leak a private bundle, since
  // sha-keyed URLs are not secret. Treat an unreadable meta as not-serveable.
  if (!meta) return { deny: json({ error: "not-found" }, 404, { headers: PREVIEW_CORS }) };
  if (!meta.private) return { ok: true, headers: PREVIEW_CORS, meta };
  const d = await authorizePreviewAccess(req, meta.repo);
  if (d === "ok") return { ok: true, headers: PRIVATE_HEADERS, meta };
  const [error, status] =
    d === "login-required" ? ["auth-required", 401] : d === "forbidden" ? ["forbidden", 403] : ["unavailable", 503];
  return { deny: json({ error }, status, { headers: PRIVATE_HEADERS }) };
}
