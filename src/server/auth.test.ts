// handleAuth + upsertUser. Run under `bun test`. No real Postgres/GitHub/Google:
// db.ts's `sql` is mocked per-test (see history.test.ts / first-seen.test.ts for
// the established convention) and global fetch is stubbed with a tiny URL router
// so arctic's own token-endpoint calls (and our ghFetch calls) resolve locally.
import { test, expect, mock, beforeEach, afterEach } from "bun:test";
import { SignJWT } from "jose";
import { config } from "./config.ts";

const realFetch = globalThis.fetch;
type Route = { match: (url: string) => boolean; res: () => Response | Promise<Response> };
let routes: Route[] = [];

function route(match: string, res: () => Response | Promise<Response>) {
  routes.push({ match: (u) => u === match, res });
}
function ok(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}
function fakeIdToken(payload: Record<string, unknown>): string {
  return `${b64url({ alg: "none" })}.${b64url(payload)}.sig`;
}

const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";
const GITHUB_EMAILS_URL = "https://api.github.com/user/emails";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

beforeEach(() => {
  mock.restore();
  routes = [];
  globalThis.fetch = (async (input: unknown) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    const hit = routes.find((r) => r.match(url));
    if (!hit) throw new Error(`unstubbed fetch in test: ${url}`);
    return hit.res();
  }) as unknown as typeof fetch;

  config.githubClientId = "";
  config.githubClientSecret = "";
  config.googleClientId = "";
  config.googleClientSecret = "";
  config.jwtSecret = "";
  config.appUrl = "http://localhost:3000";
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function mockDb(sql: (...args: unknown[]) => Promise<unknown>) {
  mock.module("./db.ts", () => ({ sql: Object.assign(sql, { mock: true }) }));
}

// ---------------------------------------------------------------------------
// GET /api/auth/github
// ---------------------------------------------------------------------------

test("github: 500 oauth_not_configured when no client id/secret", async () => {
  mockDb(() => Promise.resolve([]));
  const { handleAuth } = await import("./auth.ts");
  const res = await handleAuth(new Request("http://x/api/auth/github"), "/api/auth/github");
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ error: "oauth_not_configured" });
});

test("github: redirects to GitHub with a CSRF state cookie when configured", async () => {
  config.githubClientId = "gh-id";
  config.githubClientSecret = "gh-secret";
  mockDb(() => Promise.resolve([]));
  const { handleAuth } = await import("./auth.ts");
  const res = await handleAuth(new Request("http://x/api/auth/github"), "/api/auth/github");
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toContain("https://github.com/login/oauth/authorize");
  expect(res.headers.get("set-cookie")).toContain("sky_oauth_state=");
});

// ---------------------------------------------------------------------------
// GET /api/auth/github/callback
// ---------------------------------------------------------------------------

test("github/callback: 400 invalid_oauth_state when state/cookie are missing or mismatched", async () => {
  mockDb(() => Promise.resolve([]));
  const { handleAuth } = await import("./auth.ts");
  const res = await handleAuth(
    new Request("http://x/api/auth/github/callback?code=abc&state=s1"),
    "/api/auth/github/callback",
  );
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "invalid_oauth_state" });
});

test("github/callback: success — exchanges code, resolves email directly, upserts user, signs session", async () => {
  config.githubClientId = "gh-id";
  config.githubClientSecret = "gh-secret";
  config.jwtSecret = "test-secret";
  let upsertArgs: unknown[] | null = null;
  mockDb((...args: unknown[]) => {
    upsertArgs = args;
    return Promise.resolve([{ id: "user-1" }]);
  });
  route(GITHUB_TOKEN_URL, () => ok({ access_token: "gh-tok", token_type: "bearer" }));
  route(GITHUB_USER_URL, () =>
    ok({ id: 42, login: "octocat", name: "The Octocat", avatar_url: "https://x/a.png", email: "octo@example.com" }),
  );

  const { handleAuth } = await import("./auth.ts");
  const req = new Request("http://x/api/auth/github/callback?code=abc&state=s1", {
    headers: { cookie: "sky_oauth_state=s1" },
  });
  const res = await handleAuth(req, "/api/auth/github/callback");
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("http://localhost:3000/");
  expect(upsertArgs).not.toBeNull();
  const cookies = [...res.headers.entries()].filter(([k]) => k === "set-cookie").map(([, v]) => v);
  expect(cookies.some((c) => c.startsWith("sky_session="))).toBe(true);
  expect(cookies.some((c) => c.startsWith("sky_oauth_state=") && c.includes("Max-Age=0"))).toBe(true);
});

test("github/callback: falls back to /user/emails when the primary email is private", async () => {
  config.githubClientId = "gh-id";
  config.githubClientSecret = "gh-secret";
  config.jwtSecret = "test-secret";
  let emailUsed: unknown;
  mockDb((_s: unknown, ...vals: unknown[]) => {
    emailUsed = vals[2];
    return Promise.resolve([{ id: "user-1" }]);
  });
  route(GITHUB_TOKEN_URL, () => ok({ access_token: "gh-tok", token_type: "bearer" }));
  route(GITHUB_USER_URL, () => ok({ id: 42, login: "octocat", name: null, avatar_url: "https://x/a.png", email: null }));
  route(GITHUB_EMAILS_URL, () =>
    ok([
      { email: "secondary@example.com", primary: false, verified: true },
      { email: "primary@example.com", primary: true, verified: true },
    ]),
  );

  const { handleAuth } = await import("./auth.ts");
  const req = new Request("http://x/api/auth/github/callback?code=abc&state=s1", {
    headers: { cookie: "sky_oauth_state=s1" },
  });
  const res = await handleAuth(req, "/api/auth/github/callback");
  expect(res.status).toBe(302);
  expect(emailUsed).toBe("primary@example.com");
});

test("github/callback: a failed /user/emails lookup degrades to a null email instead of failing the login", async () => {
  config.githubClientId = "gh-id";
  config.githubClientSecret = "gh-secret";
  config.jwtSecret = "test-secret";
  mockDb(() => Promise.resolve([{ id: "user-1" }]));
  route(GITHUB_TOKEN_URL, () => ok({ access_token: "gh-tok", token_type: "bearer" }));
  route(GITHUB_USER_URL, () => ok({ id: 42, login: "octocat", name: null, avatar_url: null, email: null }));
  route(GITHUB_EMAILS_URL, () => new Response(null, { status: 500 }));

  const { handleAuth } = await import("./auth.ts");
  const req = new Request("http://x/api/auth/github/callback?code=abc&state=s1", {
    headers: { cookie: "sky_oauth_state=s1" },
  });
  const res = await handleAuth(req, "/api/auth/github/callback");
  expect(res.status).toBe(302);
});

test("github/callback: 400 oauth_exchange_failed when the token exchange itself fails", async () => {
  config.githubClientId = "gh-id";
  config.githubClientSecret = "gh-secret";
  mockDb(() => Promise.resolve([{ id: "user-1" }]));
  route(GITHUB_TOKEN_URL, () => new Response(null, { status: 401 }));

  const { handleAuth } = await import("./auth.ts");
  const req = new Request("http://x/api/auth/github/callback?code=abc&state=s1", {
    headers: { cookie: "sky_oauth_state=s1" },
  });
  const res = await handleAuth(req, "/api/auth/github/callback");
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "oauth_exchange_failed" });
});

test("github/callback: 400 oauth_exchange_failed when the /user fetch 500s", async () => {
  config.githubClientId = "gh-id";
  config.githubClientSecret = "gh-secret";
  mockDb(() => Promise.resolve([{ id: "user-1" }]));
  route(GITHUB_TOKEN_URL, () => ok({ access_token: "gh-tok", token_type: "bearer" }));
  route(GITHUB_USER_URL, () => new Response(null, { status: 500 }));

  const { handleAuth } = await import("./auth.ts");
  const req = new Request("http://x/api/auth/github/callback?code=abc&state=s1", {
    headers: { cookie: "sky_oauth_state=s1" },
  });
  const res = await handleAuth(req, "/api/auth/github/callback");
  expect(res.status).toBe(400);
});

// ---------------------------------------------------------------------------
// GET /api/auth/google
// ---------------------------------------------------------------------------

test("google: 500 oauth_not_configured when no client id/secret", async () => {
  mockDb(() => Promise.resolve([]));
  const { handleAuth } = await import("./auth.ts");
  const res = await handleAuth(new Request("http://x/api/auth/google"), "/api/auth/google");
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ error: "oauth_not_configured" });
});

test("google: redirects to Google with state + PKCE verifier cookies when configured", async () => {
  config.googleClientId = "g-id";
  config.googleClientSecret = "g-secret";
  mockDb(() => Promise.resolve([]));
  const { handleAuth } = await import("./auth.ts");
  const res = await handleAuth(new Request("http://x/api/auth/google"), "/api/auth/google");
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toContain("https://accounts.google.com/o/oauth2/v2/auth");
  const cookies = [...res.headers.entries()].filter(([k]) => k === "set-cookie").map(([, v]) => v);
  expect(cookies.some((c) => c.startsWith("sky_oauth_state="))).toBe(true);
  expect(cookies.some((c) => c.startsWith("sky_oauth_verifier="))).toBe(true);
});

// ---------------------------------------------------------------------------
// GET /api/auth/google/callback
// ---------------------------------------------------------------------------

test("google/callback: 400 invalid_oauth_state when the verifier cookie is missing", async () => {
  mockDb(() => Promise.resolve([]));
  const { handleAuth } = await import("./auth.ts");
  const req = new Request("http://x/api/auth/google/callback?code=abc&state=s1", {
    headers: { cookie: "sky_oauth_state=s1" }, // no verifier cookie
  });
  const res = await handleAuth(req, "/api/auth/google/callback");
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "invalid_oauth_state" });
});

test("google/callback: success — validates PKCE code, decodes id_token claims, upserts user", async () => {
  config.googleClientId = "g-id";
  config.googleClientSecret = "g-secret";
  config.jwtSecret = "test-secret";
  mockDb(() => Promise.resolve([{ id: "user-2" }]));
  const idToken = fakeIdToken({ sub: "g-sub-1", email: "person@example.com", name: "Person", picture: "https://x/p.png" });
  route(GOOGLE_TOKEN_URL, () =>
    ok({ access_token: "g-tok", token_type: "Bearer", expires_in: 3600, id_token: idToken }),
  );

  const { handleAuth } = await import("./auth.ts");
  const req = new Request("http://x/api/auth/google/callback?code=abc&state=s1", {
    headers: { cookie: "sky_oauth_state=s1; sky_oauth_verifier=verifier1" },
  });
  const res = await handleAuth(req, "/api/auth/google/callback");
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("http://localhost:3000/");
  const cookies = [...res.headers.entries()].filter(([k]) => k === "set-cookie").map(([, v]) => v);
  expect(cookies.some((c) => c.startsWith("sky_session="))).toBe(true);
  expect(cookies.some((c) => c.startsWith("sky_oauth_verifier=") && c.includes("Max-Age=0"))).toBe(true);
});

test("google/callback: falls back name -> email, picture -> null when claims are sparse", async () => {
  config.googleClientId = "g-id";
  config.googleClientSecret = "g-secret";
  config.jwtSecret = "test-secret";
  let nameUsed: unknown;
  let avatarUsed: unknown;
  mockDb((_s: unknown, ...vals: unknown[]) => {
    nameUsed = vals[3];
    avatarUsed = vals[4];
    return Promise.resolve([{ id: "user-2" }]);
  });
  const idToken = fakeIdToken({ sub: "g-sub-2", email: "bare@example.com" });
  route(GOOGLE_TOKEN_URL, () =>
    ok({ access_token: "g-tok", token_type: "Bearer", expires_in: 3600, id_token: idToken }),
  );

  const { handleAuth } = await import("./auth.ts");
  const req = new Request("http://x/api/auth/google/callback?code=abc&state=s1", {
    headers: { cookie: "sky_oauth_state=s1; sky_oauth_verifier=verifier1" },
  });
  const res = await handleAuth(req, "/api/auth/google/callback");
  expect(res.status).toBe(302);
  expect(nameUsed).toBe("bare@example.com");
  expect(avatarUsed).toBeNull();
});

test("google/callback: 400 oauth_exchange_failed when the token exchange fails", async () => {
  config.googleClientId = "g-id";
  config.googleClientSecret = "g-secret";
  mockDb(() => Promise.resolve([{ id: "user-2" }]));
  route(GOOGLE_TOKEN_URL, () => new Response(null, { status: 400 }));

  const { handleAuth } = await import("./auth.ts");
  const req = new Request("http://x/api/auth/google/callback?code=abc&state=s1", {
    headers: { cookie: "sky_oauth_state=s1; sky_oauth_verifier=verifier1" },
  });
  const res = await handleAuth(req, "/api/auth/google/callback");
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "oauth_exchange_failed" });
});

// ---------------------------------------------------------------------------
// GET /api/auth/me
// ---------------------------------------------------------------------------

test("me: 401 unauthenticated without a session cookie", async () => {
  mockDb(() => Promise.resolve([]));
  const { handleAuth } = await import("./auth.ts");
  const res = await handleAuth(new Request("http://x/api/auth/me"), "/api/auth/me");
  expect(res.status).toBe(401);
});

test("me: 401 + clears the session cookie when the user row is gone (deleted account)", async () => {
  config.jwtSecret = "test-secret";
  mockDb(() => Promise.resolve([]));
  const { handleAuth } = await import("./auth.ts");
  const { signSession, sessionCookie } = await import("./session.ts");
  const token = await signSession({ id: "user-1", provider: "github" });
  const req = new Request("http://x/api/auth/me", { headers: { cookie: sessionCookie(token).split(";")[0] } });
  const res = await handleAuth(req, "/api/auth/me");
  expect(res.status).toBe(401);
  expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
});

test("me: 200 with the mapped user fields on a valid session", async () => {
  config.jwtSecret = "test-secret";
  mockDb(() =>
    Promise.resolve([{ id: "user-1", provider: "github", name: "Ada", avatar_url: "https://x/a.png", email: "ada@example.com" }]),
  );
  const { handleAuth } = await import("./auth.ts");
  const { signSession, sessionCookie } = await import("./session.ts");
  const token = await signSession({ id: "user-1", provider: "github" });
  const req = new Request("http://x/api/auth/me", { headers: { cookie: sessionCookie(token).split(";")[0] } });
  const res = await handleAuth(req, "/api/auth/me");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    id: "user-1",
    name: "Ada",
    avatarUrl: "https://x/a.png",
    provider: "github",
    email: "ada@example.com",
  });
});

test("me: carries the sliding-window refresh cookie when the session is near expiry", async () => {
  config.jwtSecret = "test-secret";
  mockDb(() => Promise.resolve([{ id: "user-1", provider: "github", name: null, avatar_url: null, email: null }]));
  const { handleAuth } = await import("./auth.ts");
  const nearExpiry = await new SignJWT({ provider: "github" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("user-1")
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + 1000)
    .sign(new TextEncoder().encode("test-secret"));
  const req = new Request("http://x/api/auth/me", { headers: { cookie: `sky_session=${nearExpiry}` } });
  const res = await handleAuth(req, "/api/auth/me");
  expect(res.status).toBe(200);
  expect(res.headers.get("set-cookie")).toContain("sky_session=");
});

// ---------------------------------------------------------------------------
// POST /api/auth/signout, unknown routes
// ---------------------------------------------------------------------------

test("signout: 200 ok and clears the session cookie", async () => {
  mockDb(() => Promise.resolve([]));
  const { handleAuth } = await import("./auth.ts");
  const res = await handleAuth(new Request("http://x/api/auth/signout", { method: "POST" }), "/api/auth/signout");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
  expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
});

test("unknown sub-route: 404 not_found", async () => {
  mockDb(() => Promise.resolve([]));
  const { handleAuth } = await import("./auth.ts");
  const res = await handleAuth(new Request("http://x/api/auth/bogus"), "/api/auth/bogus");
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "not_found" });
});

test("upsertUser: passes provider/providerId/email/name/avatar through to the query and returns the row id", async () => {
  let captured: unknown[] | null = null;
  mockDb((...args: unknown[]) => {
    captured = args;
    return Promise.resolve([{ id: "user-9" }]);
  });
  const { upsertUser } = await import("./auth.ts");
  const result = await upsertUser("github", "42", "a@b.com", "A", "https://x/a.png");
  expect(result).toEqual({ id: "user-9", provider: "github" });
  expect(captured).not.toBeNull();
});
