// Shared POSTHOG_KEY/POSTHOG_HOST parse for the two independent server-side
// PostHog paths (posthog-capture.ts's hand-rolled capture, posthog-node.ts's
// SDK client) — they used to parse these two vars separately, which is exactly
// the kind of divergence posthog-node.ts's own header comment worried about.
//
// Deliberately a plain FUNCTION, not module-level constants and NOT routed
// through config.ts: both callers compute their own top-level KEY/HOST consts
// at THEIR OWN module-evaluation time, and posthog-capture.test.ts /
// posthog-node.test.ts each mutate process.env then re-import their module
// with a cache-busting query string to pick up the change — a stateless
// function re-read on every fresh evaluation preserves that; a shared
// module-level constant here (or a config.ts field, frozen at config.ts's own
// earlier first import) would not.
export interface PosthogEnv {
  key: string;
  host: string;
}

export function readPosthogEnv(): PosthogEnv {
  return {
    key: process.env.POSTHOG_KEY ?? "",
    host: process.env.POSTHOG_HOST ?? "https://us.i.posthog.com",
  };
}
