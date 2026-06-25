// First-party reverse proxy for PostHog Cloud US.
//
// The frontend points posthog-js at `<origin>/z` (see src/lib/analytics.ts) so all
// analytics traffic is same-origin (ad-blocker resistant) and flows through here.
// This handler forwards `/z/*` to PostHog, but strips EVERY header that could reveal
// the visitor's IP before forwarding. PostHog derives an event's IP from the socket
// peer (which becomes THIS server's egress IP, not the user's) and from
// X-Forwarded-For — so dropping XFF here, paired with the client's `disable_geoip`
// + `$ip: null` (analytics.ts) and the project's "Discard client IP data" setting,
// guarantees no visitor IP or geo is ever ingested.
//
// Routing: `/z/static/*` → the assets host; everything else (`/e/`, `/i/v0/e/`,
// `/decide/`, `/flags/`, `/array/`, `/s/`) → the ingestion host.
const PH_INGEST = "https://us.i.posthog.com";
const PH_ASSETS = "https://us-assets.i.posthog.com";
const MOUNT = "/z";

// Headers that can carry the originating client IP / geo — never forwarded upstream.
const IP_HEADERS = new Set([
  "x-forwarded-for",
  "x-real-ip",
  "forwarded",
  "x-client-ip",
  "cf-connecting-ip",
  "true-client-ip",
  "fastly-client-ip",
  "x-cluster-client-ip",
  "x-forwarded-host",
  "via",
]);

// Hop-by-hop / connection headers we re-derive rather than forward verbatim.
const DROP_HEADERS = new Set(["host", "connection", "content-length"]);

export async function handlePosthogProxy(req: Request, pathname: string): Promise<Response> {
  // Strip the "/z" mount: "/z/static/array.js" → "/static/array.js"; "/z" → "/".
  const rest = pathname.slice(MOUNT.length) || "/";
  const upstreamBase = rest.startsWith("/static/") ? PH_ASSETS : PH_INGEST;
  const { search } = new URL(req.url);
  const target = `${upstreamBase}${rest}${search}`;

  const headers = new Headers();
  for (const [k, v] of req.headers) {
    const lk = k.toLowerCase();
    if (IP_HEADERS.has(lk) || DROP_HEADERS.has(lk)) continue;
    headers.set(k, v);
  }
  // PostHog's edge routes/TLS-SNIs by Host — it must match the chosen upstream.
  headers.set("host", new URL(upstreamBase).host);

  const upstream = await fetch(target, {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
    // Bun streams request bodies with half-duplex; required when forwarding `req.body`.
    duplex: "half",
    redirect: "manual",
  } as RequestInit);

  // Bun's fetch transparently decompresses the upstream body, so the inherited
  // content-encoding/length would make the browser double-decode — strip both.
  const respHeaders = new Headers(upstream.headers);
  respHeaders.delete("content-encoding");
  respHeaders.delete("content-length");
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
}
