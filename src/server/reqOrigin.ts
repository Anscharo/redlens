// External base URL for the OG/Twitter/canonical meta tags in the SPA fallback.
// Railway's edge terminates TLS, so Bun always sees plain http on `req` —
// url.origin's scheme is wrong on every route (og:url, og:image, twitter:image,
// canonical would all emit http://; see docs/qa/2026-08-02-deep-qa-report.md L1).
//
// Prefer `appUrl` (config.appUrl) only when it's actually the canonical host for
// THIS request (https, and its host matches the request's host) — this mirrors
// canonicalRedirect's own host check (history/canonical.ts): PR/preview Railway
// environments inherit production's pinned APP_URL, so a bare "appUrl is https"
// check would wrongly stamp a preview's own reachable host with production's URL.
// When appUrl doesn't apply, trust the proxy's forwarded headers, falling back to
// the request's own origin when neither is present (local dev, direct hits).
//
// Kept out of index.ts (which boots a live server + DB on import, so it's never
// exercised under test) so this pure function can be unit-tested directly.
export function resolveOrigin(req: Request, url: URL, appUrl: string): string {
  if (appUrl.startsWith("https://") && new URL(appUrl).host.toLowerCase() === url.host.toLowerCase()) {
    return appUrl;
  }
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.slice(0, -1);
  const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || url.host;
  return `${proto}://${host}`;
}
