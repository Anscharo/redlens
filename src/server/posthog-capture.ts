// Thin server-side PostHog capture client. posthog-js (src/lib/analytics.ts)
// never runs here — MCP clients are server-to-server, no browser involved — so
// this hand-rolls the minimum needed to POST an event to PostHog's HTTP capture
// API, mirroring analytics.ts's philosophy (anonymous, IP-free, minimal payload)
// rather than pulling in the posthog-node SDK.
//
// No-op unless POSTHOG_KEY is set. This is a RUNTIME env var, distinct from the
// frontend's build-time VITE_POSTHOG_KEY (Vite inlines VITE_* at build time; a
// long-running Bun service needs it in the actual process env — see
// .env.example). The value is the same non-secret project API key ("phc_...")
// used client-side; PostHog does not have a separate "server" key for capture.
const KEY = process.env.POSTHOG_KEY ?? "";
// Same POSTHOG_HOST override as posthog-node.ts, so the two server paths can't
// point at different PostHog regions.
const HOST = process.env.POSTHOG_HOST ?? "https://us.i.posthog.com";
const CAPTURE_URL = `${HOST.replace(/\/$/, "")}/i/v0/e/`;

export const serverAnalyticsEnabled = Boolean(KEY);

/** Fire a server-side PostHog event. Never throws, never awaited by callers —
 *  analytics must not add latency to (or fail) the request that triggered it. */
export function captureServerEvent(event: string, distinctId: string, properties: Record<string, unknown> = {}): void {
  if (!serverAnalyticsEnabled) return;
  const body = JSON.stringify({
    api_key: KEY,
    event,
    distinct_id: distinctId,
    properties: {
      ...properties,
      $geoip_disable: true,
      // Mirrors person_profiles: "never" client-side — these are anonymous
      // tool-usage events, not people; never create/update a Person record.
      $process_person_profile: false,
    },
  });
  fetch(CAPTURE_URL, { method: "POST", headers: { "content-type": "application/json" }, body }).catch(() => {});
}
