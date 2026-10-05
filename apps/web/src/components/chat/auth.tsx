import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { apiUrl, type AuthUser } from "./api";
import { usersEnabled } from "../../lib/usersEnabled";
import { authProviders } from "../../lib/authProviders";
import { stashAuthReturn } from "../../lib/authReturn";

export type AuthProvider = "github" | "google";

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  openAuth: (provider?: AuthProvider) => void; // full-page redirect to OAuth
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<boolean>; // erase account + all data; true on success
}

const AuthContext = createContext<AuthState | null>(null);

// Default to the environment's configured provider, not always GitHub — in a
// Google-only deployment the no-arg callers (e.g. chat 401 recovery) would
// otherwise redirect to /api/auth/github, which the server rejects as
// oauth_not_configured. Falls back to "github" only if the list is empty.
// The current location is stashed so the post-OAuth landing (always the app
// root) can send the user back here instead of the home page.
function openAuth(provider?: AuthProvider) {
  const target = provider ?? authProviders()[0] ?? "github";
  stashAuthReturn(window.location.pathname + window.location.search);
  window.location.href = apiUrl(`auth/${target}`);
}

// deleteAccount cascades through everything the users row owns; it returns
// false on failure so the caller can keep the user signed in.
function sessionActions(setUser: (u: AuthUser | null) => void) {
  return {
    signOut: async () => {
      await fetch(apiUrl("auth/signout"), { method: "POST", credentials: "same-origin" }).catch(() => {
        // ignore — clear local state regardless
      });
      setUser(null);
    },
    deleteAccount: async (): Promise<boolean> => {
      const res = await fetch(apiUrl("auth/me"), { method: "DELETE", credentials: "same-origin" }).catch(() => null);
      if (!res?.ok) return false;
      setUser(null);
      return true;
    },
  };
}

// No /api backend on static deploys (GH Pages / CF Pages) or when logins are
// off / not fully configured (no JWT secret) — the boot probe is skipped
// entirely; the profile button + chat UI aren't mounted there anyway.
// usersEnabled() combines the build flag with the server's injected runtime
// capability. Any probe failure reads as signed-out.
function useAuthBoot() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!usersEnabled()) {
      setLoading(false);
      return;
    }
    let alive = true;
    fetch(apiUrl("auth/me"), { credentials: "same-origin" })
      .then((res) => (res.ok ? (res.json() as Promise<AuthUser>) : null))
      .then((u) => alive && setUser(u))
      .catch(() => alive && setUser(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);
  return { user, setUser, loading };
}

// Bootstraps auth from /api/auth/me (see useAuthBoot).
export function AuthProvider({ children }: { children: ReactNode }) {
  const { user, setUser, loading } = useAuthBoot();
  const { signOut, deleteAccount } = sessionActions(setUser);
  return (
    <AuthContext.Provider value={{ user, loading, openAuth, signOut, deleteAccount }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
