import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { apiUrl, type AuthUser } from "./api";

export type AuthProvider = "github" | "google";

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  openAuth: (provider?: AuthProvider) => void; // full-page redirect to OAuth
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

// Bootstraps auth from /api/auth/me. Tolerant of 401/404/network errors — on
// any failure the user is simply treated as signed-out (e.g. GH-Pages, where
// there is no backend), so a failed fetch never crashes the app shell.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // No /api backend on static deploys (GH Pages / CF Pages) — skip the boot
    // probe entirely; the chat UI + profile button aren't mounted there anyway.
    if (!__CHAT_ENABLED__) {
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

  const openAuth = (provider: AuthProvider = "github") => {
    window.location.href = apiUrl(`auth/${provider}`);
  };

  const signOut = async () => {
    try {
      await fetch(apiUrl("auth/signout"), { method: "POST", credentials: "same-origin" });
    } catch {
      // ignore — clear local state regardless
    }
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, loading, openAuth, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
