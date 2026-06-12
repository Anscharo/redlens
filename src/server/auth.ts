// GitHub + Google OAuth (arctic) + the /api/auth/* routes. The session itself is
// a stateless JWT cookie (see session.ts); this module only mints it after a
// successful OAuth round-trip and exposes /me + /signout.
//
//   GET  /api/auth/github           → 302 to GitHub, CSRF state in a cookie
//   GET  /api/auth/github/callback  → verify state, exchange code, upsert user, set session
//   GET  /api/auth/google           → 302 to Google, CSRF state + PKCE verifier in cookies
//   GET  /api/auth/google/callback  → verify state, exchange code (PKCE), upsert user, set session
//   GET  /api/auth/me               → { id, name, avatarUrl, provider, email } | 401
//   POST /api/auth/signout          → clear session cookie
import { GitHub, Google, decodeIdToken, generateCodeVerifier } from "arctic";
import { sql } from "./db.ts";
import { config } from "./config.ts";
import {
  getSessionUser,
  signSession,
  sessionCookie,
  clearSessionCookie,
  stateCookie,
  clearStateCookie,
  verifierCookie,
  clearVerifierCookie,
  parseCookies,
  STATE_COOKIE,
  VERIFIER_COOKIE,
  type SessionUser,
} from "./session.ts";

const GITHUB_SCOPES = ["read:user", "user:email"];
const GOOGLE_SCOPES = ["openid", "profile", "email"];

function github(): GitHub {
  return new GitHub(config.githubClientId, config.githubClientSecret, `${config.appUrl}/api/auth/github/callback`);
}

function google(): Google {
  return new Google(config.googleClientId, config.googleClientSecret, `${config.appUrl}/api/auth/google/callback`);
}

function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ location });
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(null, { status: 302, headers });
}

function json(body: unknown, status = 200, cookies: string[] = []): Response {
  const headers = new Headers({ "content-type": "application/json" });
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(JSON.stringify(body), { status, headers });
}

interface GithubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
  email: string | null;
}

async function ghFetch<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "redlens-atlas" },
  });
  if (!res.ok) throw new Error(`github ${path} ${res.status}`);
  return (await res.json()) as T;
}

// GitHub omits email when the user keeps it private; /user/emails (needs user:email)
// carries the primary verified one. Best-effort — a missing email is non-fatal.
async function resolveEmail(gh: GithubUser, token: string): Promise<string | null> {
  if (gh.email) return gh.email;
  try {
    const emails = await ghFetch<{ email: string; primary: boolean; verified: boolean }[]>("/user/emails", token);
    return emails.find((e) => e.primary && e.verified)?.email ?? null;
  } catch {
    return null;
  }
}

// provider+provider_id is the identity key (UNIQUE) — the same human signing in
// with GitHub and with Google gets two distinct rows. No email-based linking.
export async function upsertUser(
  provider: string,
  providerId: string,
  email: string | null,
  name: string | null,
  avatar: string | null,
): Promise<SessionUser> {
  const rows = (await sql`
    INSERT INTO users (provider, provider_id, email, name, avatar_url)
    VALUES (${provider}, ${providerId}, ${email}, ${name}, ${avatar})
    ON CONFLICT (provider, provider_id)
    DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, avatar_url = EXCLUDED.avatar_url
    RETURNING id
  `) as { id: string }[];
  return { id: rows[0].id, provider };
}

export async function handleAuth(req: Request, pathname: string): Promise<Response> {
  const sub = pathname.slice("/api/auth/".length);

  if (sub === "github" && req.method === "GET") {
    if (!config.githubClientId || !config.githubClientSecret) return json({ error: "oauth_not_configured" }, 500);
    const state = crypto.randomUUID();
    return redirect(github().createAuthorizationURL(state, GITHUB_SCOPES).toString(), [stateCookie(state)]);
  }

  if (sub === "github/callback" && req.method === "GET") {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const cookieState = parseCookies(req.headers.get("cookie"))[STATE_COOKIE];
    if (!code || !state || !cookieState || state !== cookieState) {
      return json({ error: "invalid_oauth_state" }, 400, [clearStateCookie()]);
    }
    try {
      const tokens = await github().validateAuthorizationCode(code);
      const token = tokens.accessToken();
      const gh = await ghFetch<GithubUser>("/user", token);
      const email = await resolveEmail(gh, token);
      const user = await upsertUser("github", String(gh.id), email, gh.name ?? gh.login, gh.avatar_url);
      return redirect(`${config.appUrl}/`, [sessionCookie(await signSession(user)), clearStateCookie()]);
    } catch {
      return json({ error: "oauth_exchange_failed" }, 400, [clearStateCookie()]);
    }
  }

  if (sub === "google" && req.method === "GET") {
    if (!config.googleClientId || !config.googleClientSecret) return json({ error: "oauth_not_configured" }, 500);
    // Google requires PKCE: the code_verifier rides a cookie across the round-trip.
    // arctic's generateCodeVerifier() yields an RFC 7636-compliant value (a UUID would be rejected).
    const state = crypto.randomUUID();
    const verifier = generateCodeVerifier();
    return redirect(google().createAuthorizationURL(state, verifier, GOOGLE_SCOPES).toString(), [
      stateCookie(state),
      verifierCookie(verifier),
    ]);
  }

  if (sub === "google/callback" && req.method === "GET") {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const cookies = parseCookies(req.headers.get("cookie"));
    const cookieState = cookies[STATE_COOKIE];
    const verifier = cookies[VERIFIER_COOKIE];
    const clear = [clearStateCookie(), clearVerifierCookie()];
    if (!code || !state || !cookieState || state !== cookieState || !verifier) {
      return json({ error: "invalid_oauth_state" }, 400, clear);
    }
    try {
      const tokens = await google().validateAuthorizationCode(code, verifier);
      // Claims come straight from the id_token (delivered over TLS from Google's
      // token endpoint, so no separate signature verification — arctic's pattern).
      const claims = decodeIdToken(tokens.idToken()) as {
        sub: string;
        email?: string;
        name?: string;
        picture?: string;
      };
      const user = await upsertUser(
        "google",
        claims.sub,
        claims.email ?? null,
        claims.name ?? claims.email ?? null,
        claims.picture ?? null,
      );
      return redirect(`${config.appUrl}/`, [sessionCookie(await signSession(user)), ...clear]);
    } catch {
      return json({ error: "oauth_exchange_failed" }, 400, clear);
    }
  }

  if (sub === "me" && req.method === "GET") {
    const session = await getSessionUser(req);
    if (!session) return json({ error: "unauthenticated" }, 401);
    const rows = (await sql`
      SELECT id, provider, name, avatar_url, email FROM users WHERE id = ${session.user.id}
    `) as { id: string; provider: string; name: string | null; avatar_url: string | null; email: string | null }[];
    if (!rows[0]) return json({ error: "unauthenticated" }, 401, [clearSessionCookie()]);
    const u = rows[0];
    return json(
      { id: u.id, name: u.name, avatarUrl: u.avatar_url, provider: u.provider, email: u.email },
      200,
      session.refresh ? [session.refresh] : [],
    );
  }

  if (sub === "signout" && req.method === "POST") {
    return json({ ok: true }, 200, [clearSessionCookie()]);
  }

  return json({ error: "not_found" }, 404);
}
