// Stateless sessions: a signed HS256 JWT in an HTTP-only cookie. No sessions
// table — the cookie is self-contained. Sliding window: getSessionUser reissues
// a fresh cookie when the token is within REFRESH_THRESHOLD of expiry, so an
// active user never sees a re-auth prompt until a full TTL of inactivity.
//
// Pure + dependency-light (jose only) so it unit-tests without Postgres/network.
import { SignJWT, jwtVerify } from "jose";
import { config } from "./config.ts";

export const SESSION_COOKIE = "sky_session";
export const STATE_COOKIE = "sky_oauth_state";
export const VERIFIER_COOKIE = "sky_oauth_verifier"; // PKCE code_verifier (Google)

const SESSION_TTL_S = 7 * 24 * 60 * 60; // 7 days
const REFRESH_THRESHOLD_S = 24 * 60 * 60; // reissue when < 24h remains
const STATE_TTL_S = 10 * 60; // OAuth round-trip window

export interface SessionUser {
  id: string;
  provider: string;
}

function key(): Uint8Array {
  if (!config.jwtSecret) throw new Error("CHAT_JWT_SECRET is not set");
  return new TextEncoder().encode(config.jwtSecret);
}

export async function signSession(user: SessionUser): Promise<string> {
  return await new SignJWT({ provider: user.provider })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_S}s`)
    .sign(key());
}

// Verify + decode. Returns null on any failure (bad sig, expired, missing secret).
export async function verifySession(token: string): Promise<SessionUser & { exp: number } | null> {
  if (!config.jwtSecret) return null;
  try {
    const { payload } = await jwtVerify(token, key());
    if (!payload.sub || typeof payload.exp !== "number") return null;
    return { id: payload.sub, provider: String(payload.provider ?? ""), exp: payload.exp };
  } catch {
    return null;
  }
}

// Resolve the session from a request. `refresh`, when present, is a Set-Cookie
// value the caller MUST attach to the response (sliding-window renewal).
export async function getSessionUser(
  req: Request,
): Promise<{ user: SessionUser; refresh?: string } | null> {
  const token = parseCookies(req.headers.get("cookie"))[SESSION_COOKIE];
  if (!token) return null;
  const payload = await verifySession(token);
  if (!payload) return null;
  const user: SessionUser = { id: payload.id, provider: payload.provider };
  const nowS = Math.floor(Date.now() / 1000);
  if (payload.exp - nowS < REFRESH_THRESHOLD_S) {
    return { user, refresh: sessionCookie(await signSession(user)) };
  }
  return { user };
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (k) out[k] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

function serializeCookie(name: string, value: string, maxAge: number): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`];
  if (config.appUrl.startsWith("https")) parts.push("Secure");
  return parts.join("; ");
}

export const sessionCookie = (token: string): string => serializeCookie(SESSION_COOKIE, token, SESSION_TTL_S);
export const clearSessionCookie = (): string => serializeCookie(SESSION_COOKIE, "", 0);
export const stateCookie = (state: string): string => serializeCookie(STATE_COOKIE, state, STATE_TTL_S);
export const clearStateCookie = (): string => serializeCookie(STATE_COOKIE, "", 0);
export const verifierCookie = (verifier: string): string => serializeCookie(VERIFIER_COOKIE, verifier, STATE_TTL_S);
export const clearVerifierCookie = (): string => serializeCookie(VERIFIER_COOKIE, "", 0);
