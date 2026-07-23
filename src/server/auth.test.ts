// handleAuth: GitHub + Google OAuth round-trips, /me, /signout. Run under
// `bun test`. Mocks "arctic" (no real OAuth network calls) and "./db.ts"
// (no Postgres) so the whole surface unit-tests deterministically. session.ts
// itself is real (jose only, no I/O) — same convention as session.test.ts.
import { test, expect, beforeAll, afterEach, mock } from "bun:test";
import { config } from "./config.ts";

let ghValidate: (code: string) => Promise<{ accessToken: () => string }> = async () => ({ accessToken: () => "gh-token" });
let googleValidate: (code: string, verifier: string) => Promise<{ idToken: () => string }> = async () => ({ idToken: () => "id-token" });
let googleClaims: { sub: string; email?: string; name?: string; picture?: string } = {
  sub: "g-1",
  email: "g@example.com",
  name: "G Name",
  picture: "http://pic.example/x.png",
};

mock.module("arctic", () => ({
  GitHub: class {
    constructor(_id: string, _secret: string, _redirect: string) {}
    createAuthorizationURL(state: string, _scopes: string[]) {
      return new URL(`https://github.com/login/oauth/authorize?state=${state}`);
    }
    async validateAuthorizationCode(code: string) {
      return ghValidate(code);
    }
  },
  Google: class {
    constructor(_id: string, _secret: string, _redirect: string) {}
    createAuthorizationURL(state: string, verifier: string, _scopes: string[]) {
      return new URL(`https://accounts.google.com/o/oauth2/v2/auth?state=${state}&cv=${verifier}`);
    }
    async validateAuthorizationCode(code: string, verifier: string) {
      return googleValidate(code, verifier);
    }
  },
  decodeIdToken: (_idToken: string) => googleClaims,
  generateCodeVerifier: () => "test-code-verifier",
}));

let sqlImpl: (text: string, values: unknown[]) => Promise<unknown[]> = async () => [];
const sqlCalls: { text: string; values: unknown[] }[] = [];
mock.module("./db.ts", () => ({
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join("?");
      sqlCalls.push({ text, values });
      return sqlImpl(text, values);
    },
    { mock: true },
  ),
}));

const { handleAuth, upsertUser } = await import("./auth.ts");
const { signSession, SESSION_COOKIE, STATE_COOKIE, VERIFIER_COOKIE } = await import("./session.ts");

const JWT_SECRET = "auth-test-secret";
const origGithubId = config.githubClientId;
const origGithubSecret = config.githubClientSecret;
const origGoogleId = config.googleClientId;
const origGoogleSecret = config.googleClientSecret;

beforeAll(() => {
  config.jwtSecret = JWT_SECRET;
});

afterEach(() => {
  config.githubClientId = origGithubId;
  config.githubClientSecret = origGithubSecret;
  config.googleClientId = origGoogleId;
  config.googleClientSecret = origGoogleSecret;
  config.jwtSecret = JWT_SECRET;
  sqlCalls.length = 0;
  ghValidate = async () => ({ accessToken: () => "gh-token" });
  googleValidate = async () => ({ idToken: () => "id-token" });
  googleClaims = { sub: "g-1", email: "g@example.com", name: "G Name", picture: "http://pic.example/x.png" };
});

function configureGithub() {
  config.githubClientId = "gh-client-id";
  config.githubClientSecret = "gh-client-secret";
}
function configureGoogle() {
  config.googleClientId = "goog-client-id";
  config.googleClientSecret = "goog-client-secret";
}

function req(pathname: string, opts: { method?: string; cookie?: string; search?: string } = {}): Request {
  const url = `http://localhost${pathname}${opts.search ?? ""}`;
  return new Request(url, { method: opts.method ?? "GET", headers: opts.cookie ? { cookie: opts.cookie } : {} });
}

function setCookies(res: Response): string[] {
  return res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get("set-cookie") ?? ""].filter(Boolean);
}
function cookieValue(cookies: string[], name: string): string | undefined {
  for (const c of cookies) {
    const [pair] = c.split(";");
    const eq = pair.indexOf("=");
    if (eq >= 0 && pair.slice(0, eq) === name) return decodeURIComponent(pair.slice(eq + 1));
  }
  return undefined;
}

const realFetch = globalThis.fetch;
let fetchImpl: (url: string, init: RequestInit) => Promise<Response> = async () => new Response("{}", { status: 200 });
afterEach(() => {
  globalThis.fetch = realFetch;
});
function stubFetch() {
  globalThis.fetch = (((url: string, init: RequestInit) => fetchImpl(String(url), init)) as unknown) as typeof fetch;
}

// ── github: authorize ────────────────────────────────────────────────────

test("github: 500 oauth_not_configured when client id/secret are unset", async () => {
  config.githubClientId = "";
  config.githubClientSecret = "";
  const res = await handleAuth(req("/api/auth/github"), "/api/auth/github");
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ error: "oauth_not_configured" });
});

test("github: redirects to GitHub with a state cookie when configured", async () => {
  configureGithub();
  const res = await handleAuth(req("/api/auth/github"), "/api/auth/github");
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toContain("github.com/login/oauth/authorize?state=");
  const cookies = setCookies(res);
  expect(cookieValue(cookies, STATE_COOKIE)).toBeDefined();
});

// ── github: callback ─────────────────────────────────────────────────────

test("github/callback: 400 invalid_oauth_state when code/state/cookie are missing", async () => {
  configureGithub();
  const res = await handleAuth(req("/api/auth/github/callback"), "/api/auth/github/callback");
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "invalid_oauth_state" });
});

test("github/callback: 400 invalid_oauth_state when state doesn't match the cookie", async () => {
  configureGithub();
  const res = await handleAuth(
    req("/api/auth/github/callback", { cookie: `${STATE_COOKIE}=abc`, search: "?code=c1&state=xyz" }),
    "/api/auth/github/callback",
  );
  expect(res.status).toBe(400);
});

test("github/callback: success — resolves email directly from the /user payload, upserts, sets session cookie", async () => {
  configureGithub();
  stubFetch();
  fetchImpl = async (url) => {
    expect(url).toBe("https://api.github.com/user");
    return new Response(JSON.stringify({ id: 42, login: "octocat", name: "The Octocat", avatar_url: "http://a/o.png", email: "octo@example.com" }), { status: 200 });
  };
  sqlImpl = async () => [{ id: "user-uuid-1" }];

  const res = await handleAuth(
    req("/api/auth/github/callback", { cookie: `${STATE_COOKIE}=st1`, search: "?code=c1&state=st1" }),
    "/api/auth/github/callback",
  );
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe(`${config.appUrl}/`);
  const cookies = setCookies(res);
  expect(cookieValue(cookies, SESSION_COOKIE)).toBeDefined();
  expect(cookieValue(cookies, STATE_COOKIE)).toBe("");

  expect(sqlCalls).toHaveLength(1);
  expect(sqlCalls[0].values).toEqual(["github", "42", "octo@example.com", "The Octocat", "http://a/o.png"]);
});

test("github/callback: success — falls back to /user/emails when the /user payload has no email, picking the primary+verified one", async () => {
  configureGithub();
  stubFetch();
  fetchImpl = async (url) => {
    if (url === "https://api.github.com/user") {
      return new Response(JSON.stringify({ id: 7, login: "bob", name: null, avatar_url: "http://a/b.png", email: null }), { status: 200 });
    }
    expect(url).toBe("https://api.github.com/user/emails");
    return new Response(
      JSON.stringify([
        { email: "secondary@example.com", primary: false, verified: true },
        { email: "primary@example.com", primary: true, verified: true },
      ]),
      { status: 200 },
    );
  };
  sqlImpl = async () => [{ id: "user-uuid-2" }];

  const res = await handleAuth(
    req("/api/auth/github/callback", { cookie: `${STATE_COOKIE}=st2`, search: "?code=c2&state=st2" }),
    "/api/auth/github/callback",
  );
  expect(res.status).toBe(302);
  expect(sqlCalls[0].values).toEqual(["github", "7", "primary@example.com", "bob", "http://a/b.png"]);
});

test("github/callback: success — /user/emails failure is swallowed, email resolves to null", async () => {
  configureGithub();
  stubFetch();
  fetchImpl = async (url) => {
    if (url === "https://api.github.com/user") {
      return new Response(JSON.stringify({ id: 9, login: "nomail", name: "No Mail", avatar_url: "http://a/n.png", email: null }), { status: 200 });
    }
    return new Response("forbidden", { status: 403 });
  };
  sqlImpl = async () => [{ id: "user-uuid-3" }];

  const res = await handleAuth(
    req("/api/auth/github/callback", { cookie: `${STATE_COOKIE}=st3`, search: "?code=c3&state=st3" }),
    "/api/auth/github/callback",
  );
  expect(res.status).toBe(302);
  expect(sqlCalls[0].values).toEqual(["github", "9", null, "No Mail", "http://a/n.png"]);
});

test("github/callback: 400 oauth_exchange_failed when the code exchange throws", async () => {
  configureGithub();
  ghValidate = async () => {
    throw new Error("bad code");
  };
  const origError = console.error;
  console.error = () => {};
  const res = await handleAuth(
    req("/api/auth/github/callback", { cookie: `${STATE_COOKIE}=st4`, search: "?code=c4&state=st4" }),
    "/api/auth/github/callback",
  );
  console.error = origError;
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "oauth_exchange_failed" });
  expect(cookieValue(setCookies(res), STATE_COOKIE)).toBe("");
});

// ── google: authorize ────────────────────────────────────────────────────

test("google: 500 oauth_not_configured when client id/secret are unset", async () => {
  config.googleClientId = "";
  config.googleClientSecret = "";
  const res = await handleAuth(req("/api/auth/google"), "/api/auth/google");
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ error: "oauth_not_configured" });
});

test("google: redirects to Google with state + PKCE verifier cookies when configured", async () => {
  configureGoogle();
  const res = await handleAuth(req("/api/auth/google"), "/api/auth/google");
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toContain("accounts.google.com/o/oauth2/v2/auth?state=");
  const cookies = setCookies(res);
  expect(cookieValue(cookies, STATE_COOKIE)).toBeDefined();
  expect(cookieValue(cookies, VERIFIER_COOKIE)).toBe("test-code-verifier");
});

// ── google: callback ─────────────────────────────────────────────────────

test("google/callback: 400 invalid_oauth_state when the verifier cookie is missing", async () => {
  configureGoogle();
  const res = await handleAuth(
    req("/api/auth/google/callback", { cookie: `${STATE_COOKIE}=gst1`, search: "?code=gc1&state=gst1" }),
    "/api/auth/google/callback",
  );
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "invalid_oauth_state" });
});

test("google/callback: success — upserts with full claims, sets session cookie, clears state+verifier", async () => {
  configureGoogle();
  sqlImpl = async () => [{ id: "user-uuid-g1" }];
  const res = await handleAuth(
    req("/api/auth/google/callback", {
      cookie: `${STATE_COOKIE}=gst2; ${VERIFIER_COOKIE}=v2`,
      search: "?code=gc2&state=gst2",
    }),
    "/api/auth/google/callback",
  );
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe(`${config.appUrl}/`);
  const cookies = setCookies(res);
  expect(cookieValue(cookies, SESSION_COOKIE)).toBeDefined();
  expect(cookieValue(cookies, STATE_COOKIE)).toBe("");
  expect(cookieValue(cookies, VERIFIER_COOKIE)).toBe("");
  expect(sqlCalls[0].values).toEqual(["google", "g-1", "g@example.com", "G Name", "http://pic.example/x.png"]);
});

test("google/callback: success — missing optional claims fall back to null/email/null", async () => {
  configureGoogle();
  googleClaims = { sub: "g-minimal" };
  sqlImpl = async () => [{ id: "user-uuid-g2" }];
  const res = await handleAuth(
    req("/api/auth/google/callback", {
      cookie: `${STATE_COOKIE}=gst3; ${VERIFIER_COOKIE}=v3`,
      search: "?code=gc3&state=gst3",
    }),
    "/api/auth/google/callback",
  );
  expect(res.status).toBe(302);
  expect(sqlCalls[0].values).toEqual(["google", "g-minimal", null, null, null]);
});

test("google/callback: 400 oauth_exchange_failed when the code exchange throws", async () => {
  configureGoogle();
  googleValidate = async () => {
    throw new Error("bad google code");
  };
  const origError = console.error;
  console.error = () => {};
  const res = await handleAuth(
    req("/api/auth/google/callback", {
      cookie: `${STATE_COOKIE}=gst4; ${VERIFIER_COOKIE}=v4`,
      search: "?code=gc4&state=gst4",
    }),
    "/api/auth/google/callback",
  );
  console.error = origError;
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "oauth_exchange_failed" });
});

// ── me / signout / not found ─────────────────────────────────────────────

test("me: 401 unauthenticated without a session cookie", async () => {
  const res = await handleAuth(req("/api/auth/me"), "/api/auth/me");
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ error: "unauthenticated" });
});

test("me: 401 + clears the session cookie when the session is valid but the user row is gone", async () => {
  const token = await signSession({ id: "ghost-id", provider: "github" });
  sqlImpl = async () => [];
  const res = await handleAuth(req("/api/auth/me", { cookie: `${SESSION_COOKIE}=${token}` }), "/api/auth/me");
  expect(res.status).toBe(401);
  expect(cookieValue(setCookies(res), SESSION_COOKIE)).toBe("");
});

test("me: 200 with the user's fields when found", async () => {
  const token = await signSession({ id: "user-uuid-1", provider: "github" });
  sqlImpl = async () => [{ id: "user-uuid-1", provider: "github", name: "Octo", avatar_url: "http://a/o.png", email: "octo@example.com" }];
  const res = await handleAuth(req("/api/auth/me", { cookie: `${SESSION_COOKIE}=${token}` }), "/api/auth/me");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ id: "user-uuid-1", name: "Octo", avatarUrl: "http://a/o.png", provider: "github", email: "octo@example.com" });
});

test("signout: 200 ok, clears the session cookie", async () => {
  const res = await handleAuth(req("/api/auth/signout", { method: "POST" }), "/api/auth/signout");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
  expect(cookieValue(setCookies(res), SESSION_COOKIE)).toBe("");
});

test("unknown sub-route returns 404 not_found", async () => {
  const res = await handleAuth(req("/api/auth/bogus"), "/api/auth/bogus");
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "not_found" });
});

test("upsertUser issues an INSERT ... ON CONFLICT keyed on provider+provider_id and returns the row id", async () => {
  sqlImpl = async () => [{ id: "u-direct" }];
  const user = await upsertUser("github", "123", "e@x.com", "Name", "http://a");
  expect(user).toEqual({ id: "u-direct", provider: "github" });
  expect(sqlCalls[0].text).toContain("INSERT INTO users");
  expect(sqlCalls[0].text).toContain("ON CONFLICT (provider, provider_id)");
});
