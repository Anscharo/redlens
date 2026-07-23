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
// Returns [] when logins are off. If the flag is missing or still the unreplaced
// placeholder (static/no-server hosting, where usersEnabled() is already false),
// we fall back to both providers so a mis-injected value never hides a working
// sign-in — usersEnabled() is the outer gate.
export function authProviders(): AuthProvider[] {
  if (!usersEnabled()) return [];
  const raw = typeof window !== "undefined" ? window.__AUTH_PROVIDERS__ : undefined;
  if (!raw || raw.startsWith("{{")) return [...ALL];
  const picked = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is AuthProvider => (ALL as string[]).includes(s));
  return picked.length ? picked : [...ALL];
}
