import { usersEnabled } from "./usersEnabled";

export type AuthProvider = "github" | "google";

const ALL: AuthProvider[] = ["github", "google"];

// Which OAuth providers this environment offers, so the sign-in UI renders only
// the configured buttons. The server injects `window.__AUTH_PROVIDERS__` into
// index.html at serve time (a CSV derived from config.githubAuthEnabled /
// config.googleAuthEnabled — each true only when that provider's credentials are
// set). An environment that configures only one provider therefore shows only
// that provider's sign-in.
//
// Returns [] when logins are off. Only a genuinely absent flag (undefined) or the
// still-unreplaced placeholder (static/no-server hosting, where usersEnabled() is
// already false) falls back to both providers, so a mis-injected value never
// hides a working sign-in. An intentionally-empty CSV ("") — which the server
// injects when USERS_ENABLED is on but no provider pair is configured — means
// "no providers", so we return [] (no buttons) rather than falling back to both.
export function authProviders(): AuthProvider[] {
  if (!usersEnabled()) return [];
  const raw = typeof window !== "undefined" ? window.__AUTH_PROVIDERS__ : undefined;
  if (raw === undefined || raw.startsWith("{{")) return [...ALL];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is AuthProvider => (ALL as string[]).includes(s));
}
