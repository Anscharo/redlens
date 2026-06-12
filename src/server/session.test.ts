// Pure session/JWT unit tests. Run under `bun test`. No Postgres/network: we
// drive config.jwtSecret directly (key() reads it lazily at call time).
import { test, expect, beforeAll } from "bun:test";
import { SignJWT } from "jose";
import { config } from "./config.ts";
import {
  signSession,
  verifySession,
  getSessionUser,
  parseCookies,
  sessionCookie,
  clearSessionCookie,
  SESSION_COOKIE,
} from "./session.ts";

const SECRET = "test-secret-do-not-use-in-prod";
beforeAll(() => {
  config.jwtSecret = SECRET;
});

function reqWithSession(token: string): Request {
  return new Request("http://localhost/api/auth/me", { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
}

test("parseCookies splits pairs and url-decodes values", () => {
  expect(parseCookies("a=1; b=hello%20world; c=")).toEqual({ a: "1", b: "hello world", c: "" });
  expect(parseCookies(null)).toEqual({});
});

test("sign → verify round-trips subject + provider", async () => {
  const token = await signSession({ id: "user-1", provider: "github" });
  const payload = await verifySession(token);
  expect(payload?.id).toBe("user-1");
  expect(payload?.provider).toBe("github");
  expect(typeof payload?.exp).toBe("number");
});

test("verify rejects a tampered token", async () => {
  const token = await signSession({ id: "user-1", provider: "github" });
  expect(await verifySession(token.slice(0, -2) + "xx")).toBeNull();
});

test("verify returns null when the secret is unset", async () => {
  const token = await signSession({ id: "user-1", provider: "github" });
  config.jwtSecret = "";
  expect(await verifySession(token)).toBeNull();
  config.jwtSecret = SECRET;
});

test("session cookie carries HttpOnly, SameSite=Lax, Max-Age; clear sets Max-Age=0", async () => {
  const token = await signSession({ id: "user-1", provider: "github" });
  const cookie = sessionCookie(token);
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("SameSite=Lax");
  expect(cookie).toContain(`Max-Age=${7 * 24 * 60 * 60}`);
  expect(clearSessionCookie()).toContain("Max-Age=0");
});

test("getSessionUser refreshes a near-expiry token, not a fresh one", async () => {
  const fresh = await signSession({ id: "user-1", provider: "github" });
  const freshSession = await getSessionUser(reqWithSession(fresh));
  expect(freshSession?.user.id).toBe("user-1");
  expect(freshSession?.refresh).toBeUndefined();

  // Hand-mint a token expiring in 1000s (< 24h threshold) → must reissue.
  const nearExpiry = await new SignJWT({ provider: "github" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("user-1")
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + 1000)
    .sign(new TextEncoder().encode(SECRET));
  const renewed = await getSessionUser(reqWithSession(nearExpiry));
  expect(renewed?.user.id).toBe("user-1");
  expect(renewed?.refresh).toContain(`${SESSION_COOKIE}=`);
});

test("getSessionUser returns null without a cookie", async () => {
  expect(await getSessionUser(new Request("http://localhost/"))).toBeNull();
});
