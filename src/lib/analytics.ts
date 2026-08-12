// Cookieless, IP-free, minimal-payload PostHog client. Fully no-op unless
// VITE_POSTHOG_KEY is set, so the feature is invisible until a key is provided at
// build time (mirrors the VITE_CHAT_ENABLED pattern). All traffic is first-party
// via the Bun /z proxy (api_host below), which strips IP headers; combined with
// $geoip_disable + dropping any client $ip here, no IP or geo is ever ingested.
//
// Super properties on every event:
//   host, environment   → one project serves dev + prod; filter dev out in PostHog
//   app_commit          → our repo commit (__COMMIT_HASH__)
//   atlas_commit        → the live atlas sha (window.__ATLAS_SHA__)
//   nav_type            → navigate/reload/back_forward/prerender, from Navigation Timing
//
// Data minimisation: autocapture and PostHog's chatty enrichments are OFF, and
// sanitizeProps() trims each event to a tight allowlist — our own properties plus
// a handful of PostHog internals. Widen KEEP_DOLLAR to bring a built-in back.
import posthog from "posthog-js";

const KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
export const analyticsEnabled = Boolean(KEY);

let started = false;

// Only the canonical production domain is "prod"; every other deployment
// (localhost, Railway preview URLs, PR environments, …) is "dev".
const PROD_HOST = "atlas.redline.support";
function deriveEnvironment(host: string): "dev" | "prod" {
  return host === PROD_HOST ? "prod" : "dev";
}

// The only PostHog-internal ($-prefixed) properties we keep. Everything else
// PostHog auto-attaches ($screen_*, $os, $raw_user_agent, $lib_*, UTMs, click
// ids, …) is dropped — including any client $ip. Our own props are never
// $-prefixed, so they always pass through.
const KEEP_DOLLAR = new Set([
  "$session_id",
  "$window_id",
  "$current_url",
  "$pathname",
  "$device_type",
  "$browser",
  "$viewport_height",
  "$viewport_width",
  "$referrer",
  "$referring_domain",
  "$insert_id",
  "$time",
  "$geoip_disable",
]);

// Runs on every event before send: disable geoip, then strip all non-allowlisted
// built-in properties (which also removes any $ip) to keep the payload minimal.
// $web_vitals_* metric props are exempted so the $web_vitals event keeps its values.
// PostHog hands us a fresh props object per-event (not reused post-hook), so
// mutating in place is safe.
function sanitizeProps(props: Record<string, unknown>): Record<string, unknown> {
  props.$geoip_disable = true;
  // Guarantee `host` on EVERY event (pageview, web-vitals, exception, custom),
  // independent of super-property registration timing.
  props.host = window.location.hostname;
  // Standardize the page URL to a relative path (pathname + search). posthog-js
  // auto-fills $current_url with the full href on most events while our manual
  // pageview() sends a relative path — normalize both. The domain travels
  // separately as the `host` super property.
  if (typeof props.$current_url === "string") props.$current_url = toRelativeUrl(props.$current_url);
  for (const k of Object.keys(props)) {
    if (
      k.startsWith("$") &&
      !KEEP_DOLLAR.has(k) &&
      !k.startsWith("$web_vitals") &&
      !k.startsWith("$exception") // keep error-tracking props ($exception_list, _message, …)
    ) {
      delete props[k];
    }
  }
  return props;
}

// Full href or relative → relative "pathname + search" (no protocol/domain/hash).
function toRelativeUrl(url: string): string {
  try {
    const u = new URL(url, window.location.origin);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

// Distinguishes a fresh navigation from a reload / back-forward nav / prerender
// on every event — cheap and otherwise invisible in PostHog's own properties.
// Guarded: the Navigation Timing L2 API is unavailable in some embeds/test envs.
function navType(): string {
  // getEntriesByType is typed as PerformanceEntry[]; `type` lives on the
  // PerformanceNavigationTiming subtype "navigation" entries actually are.
  const nav = performance.getEntriesByType?.("navigation")?.[0] as PerformanceNavigationTiming | undefined;
  return nav?.type ?? "unknown";
}

// Deliberately NOT imported from lib/atlasBase.ts — that would create an
// analytics <-> atlasBase import cycle. Keep in sync with atlasBase.ts's SHA_RE.
const SHA_RE = /^[0-9a-f]{40}$/i;

export function initAnalytics(): void {
  if (!analyticsEnabled || started) return;
  started = true;

  posthog.init(KEY!, {
    api_host: `${window.location.origin}/z`, // same-origin first-party proxy
    ui_host: "https://us.posthog.com", // toolbar/links resolve to the real PostHog app
    persistence: "sessionStorage", // cookieless; survives reload within a tab, clears on close
    person_profiles: "never", // strictly anonymous — no $identify, no PII, no GitHub linkage
    capture_pageview: false, // we fire SPA $pageviews manually (usePageAnalytics)
    capture_pageleave: true, // session-duration only; no PII
    autocapture: false, // no incidental DOM capture — only our curated events + pageviews
    disable_session_recording: true, // never record DOM/inputs
    capture_performance: { web_vitals: true }, // web-vitals ($web_vitals event); resource/network timing off
    capture_exceptions: true, // error tracking: autocaptures unhandled errors/rejections + enables captureException()
    disable_surveys: true, // no surveys feature/assets
    advanced_disable_flags: true, // no /flags round-trip (we use no feature flags)
    // NOTE: external dependency loading stays ENABLED — the web-vitals collector and
    // the exception-autocapture extension load as external chunks (via the /z/static
    // proxy). Disabling it silently breaks both $web_vitals and $exception parsing.
    sanitize_properties: sanitizeProps,
  });

  const host = window.location.hostname;
  const nav = navType();
  posthog.register({
    host,
    environment: deriveEnvironment(host),
    app_commit: __COMMIT_HASH__,
    atlas_commit: window.__ATLAS_SHA__ || null,
    nav_type: nav,
    // Disable PostHog's server-side GeoIP enrichment on every event (no
    // country/city/lat-lon). Also enforced per-event in sanitizeProps.
    $geoip_disable: true,
  });
  // Uncaught errors + unhandled promise rejections are autocaptured by
  // capture_exceptions above. We still call captureException() explicitly for
  // *handled* errors (ErrorBoundary, worker onerror) that never go uncaught.

  // Catches a page served from an un-injected HTML shell (the Bun server's
  // {{ATLAS_SHA}} placeholder substitution didn't run — see lib/atlasBase.ts).
  const shaRaw = window.__ATLAS_SHA__;
  if (!shaRaw || !SHA_RE.test(shaRaw)) {
    track("shell_uninjected", { raw: String(shaRaw ?? "").slice(0, 12), nav_type: nav });
  }

  // atlasBase.ts's reloadOnce() stashes the sha it reloaded away from here
  // before forcing a reload; read-and-clear it so the forced reload shows up
  // as one paired event instead of two unrelated page loads.
  try {
    const from = sessionStorage.getItem("rl-forced-reload-from");
    if (from) {
      sessionStorage.removeItem("rl-forced-reload-from");
      track("forced_reload", { from, to: window.__ATLAS_SHA__ || null });
    }
  } catch {
    // private mode / quota — losing this pairing is a soft degradation
  }
}

/** Set a super property that auto-attaches to all subsequent events. */
export function register(props: Record<string, unknown>): void {
  if (!analyticsEnabled) return;
  posthog.register(props);
}

/** Fire a custom event. No-op when analytics is disabled. */
export function track(event: string, props?: Record<string, unknown>): void {
  if (!analyticsEnabled) return;
  posthog.capture(event, props);
}

/** Report an exception to PostHog error tracking. No-op when disabled. Wrap any
 *  catch/ErrorBoundary that handles an unexpected error. */
export function captureException(error: unknown, extra?: Record<string, unknown>): void {
  if (!analyticsEnabled) return;
  posthog.captureException(error, extra);
}

/** Manual SPA pageview (capture_pageview is off). */
export function pageview(path: string): void {
  if (!analyticsEnabled) return;
  posthog.capture("$pageview", { $current_url: path });
}

/** PostHog session id, for joining a feedback row to its analytics session. */
export function sessionId(): string | null {
  return analyticsEnabled ? (posthog.get_session_id() ?? null) : null;
}
