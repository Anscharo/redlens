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

// The one-line boot report of the canonical-redirect decision, in BOTH
// directions — the gate turns on a single env string (railwayEnv === "production"),
// and either way of getting it wrong is invisible until a human opens a URL:
//   ON  outside production → the deploy 301s its own hostname away (PR previews
//       inherit production's pinned APP_URL, so this black-holes them).
//   OFF in production      → OAuth on secondary attached domains dies with
//       invalid_oauth_state, the very thing this module exists to prevent.
// Returns null when appUrl isn't https (local dev): canonicalRedirect is inert
// there anyway, so there's nothing to report. Pure so index.ts's boot glue stays
// a thin, untestable one-liner while the decision itself is unit-tested.
export function canonicalRedirectBootLog(cfg: {
  appUrl: string;
  canonicalHostRedirect: boolean;
  railwayEnv: string;
}): string | null {
  if (!cfg.appUrl.startsWith("https://")) return null;
  const host = new URL(cfg.appUrl).host;
  return cfg.canonicalHostRedirect
    ? `↪️  canonical-host redirect ON (env="${cfg.railwayEnv}") — GETs on any host but ${host} 301 to ${cfg.appUrl}`
    : `↪️  canonical-host redirect OFF (env="${cfg.railwayEnv}") — expected in preview/PR envs. If this IS production, the env name is not "production" and OAuth on secondary domains will fail: set CANONICAL_HOST_REDIRECT=1.`;
}
