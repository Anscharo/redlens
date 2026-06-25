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
    capture_performance: { web_vitals: true }, // web-vitals ($web_vitals event) on; resource/network timing off
    disable_surveys: true, // no surveys feature/assets
    disable_external_dependency_loading: true, // don't fetch toolbar/recorder/survey scripts
    advanced_disable_flags: true, // no /flags round-trip (we use no feature flags)
    sanitize_properties: sanitizeProps,
  });

  const host = window.location.hostname;
  posthog.register({
    host,
    environment: deriveEnvironment(host),
    app_commit: __COMMIT_HASH__,
    atlas_commit: window.__ATLAS_SHA__ || null,
    // Disable PostHog's server-side GeoIP enrichment on every event (no
    // country/city/lat-lon). Also enforced per-event in sanitizeProps.
    $geoip_disable: true,
  });

  // Catch-all: report uncaught errors and unhandled promise rejections that no
  // try/catch or ErrorBoundary handled. (React render errors don't reach
  // window.onerror — those are reported explicitly from ErrorBoundary.)
  window.addEventListener("error", (e) =>
    captureException(e.error ?? e.message, { mechanism: "window.onerror" }),
  );
  window.addEventListener("unhandledrejection", (e) =>
    captureException(e.reason, { mechanism: "unhandledrejection" }),
  );
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
