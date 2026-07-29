// Canonical-host redirect. The service can have several domains attached
// (apex + subdomain + the *.up.railway.app default), but OAuth only works on
// ONE of them: the provider callback URL is registered against a single host,
// and the CSRF state cookie is host-only (session.ts sets no Domain attribute),
// so a sign-in started on any other host dies with invalid_oauth_state even
// when the redirect URI is accepted. Rather than trying to make every host
// work, funnel all safe (GET/HEAD) traffic to the canonical origin — appUrl.
//
// Guards:
// - appUrl must be https: locally appUrl is http://localhost:<port> and the
//   dev server is reached under several names (localhost, 127.0.0.1, LAN IP).
// - host-only comparison, never protocol: TLS terminates at the Railway edge,
//   so the request seen here is plain http on the right host — comparing
//   origins would loop forever.
// - production only: config.canonicalHostRedirect is gated on the Railway
//   environment name, because PR/preview environments inherit production's
//   pinned APP_URL and would otherwise 301 their own hostname to prod. See the
//   railwayEnv note in config.ts; CANONICAL_HOST_REDIRECT=0/1 forces off/on.
import { config } from "../config.ts";

export function canonicalRedirect(req: Request): Response | null {
  if (!config.canonicalHostRedirect) return null;
  if (!config.appUrl.startsWith("https://")) return null;
  if (req.method !== "GET" && req.method !== "HEAD") return null;
  const url = new URL(req.url);
  const canonical = new URL(config.appUrl);
  if (url.host.toLowerCase() === canonical.host.toLowerCase()) return null;
  return new Response(null, {
    status: 301,
    headers: { location: `${canonical.origin}${url.pathname}${url.search}` },
  });
}
