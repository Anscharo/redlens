import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { apiUrl, type AuthUser } from "./api";
import { usersEnabled } from "@/lib/usersEnabled";
import { authProviders } from "@/lib/authProviders";
import { stashAuthReturn } from "@/lib/authReturn";

export type AuthProvider = "github" | "google";

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  openAuth: (provider?: AuthProvider) => void; // full-page redirect to OAuth
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<boolean>; // erase account + all data; true on success
}

const AuthContext = createContext<AuthState | null>(null);

// Bootstraps auth from /api/auth/me. Tolerant of 401/404/network errors — on
// any failure the user is simply treated as signed-out (e.g. GH-Pages, where
// there is no backend), so a failed fetch never crashes the app shell.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // No /api backend on static deploys (GH Pages / CF Pages) or when logins are
    // off / not fully configured (no JWT secret) — skip the boot probe entirely;
    // the profile button + chat UI aren't mounted there anyway. usersEnabled()
    // combines the build flag with the server's injected runtime capability.
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

  const openAuth = (provider?: AuthProvider) => {
    // Default to the environment's configured provider, not always GitHub — in a
    // Google-only deployment the no-arg callers (e.g. chat 401 recovery) would
    // otherwise redirect to /api/auth/github, which the server rejects as
    // oauth_not_configured. Fall back to "github" only if the list is empty.
    const target = provider ?? authProviders()[0] ?? "github";
    // Remember where we are so the post-OAuth landing (always the app root) can
    // send us back here instead of dumping us on the home page.
    stashAuthReturn(window.location.pathname + window.location.search);
    window.location.href = apiUrl(`auth/${target}`);
  };

  const signOut = async () => {
    try {
      await fetch(apiUrl("auth/signout"), { method: "POST", credentials: "same-origin" });
    } catch {
      // ignore — clear local state regardless
    }
    setUser(null);
  };

  // Permanently delete the account and all associated data (chats, Collections).
  // The server clears the session cookie; we drop local state on success so the UI
  // returns to the signed-out view. Returns false on failure so the caller can
  // keep the user signed in and surface an error.
  const deleteAccount = async (): Promise<boolean> => {
    try {
      const res = await fetch(apiUrl("auth/me"), { method: "DELETE", credentials: "same-origin" });
      if (!res.ok) return false;
      setUser(null);
      return true;
    } catch {
      return false;
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, openAuth, signOut, deleteAccount }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
