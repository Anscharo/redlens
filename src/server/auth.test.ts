import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

let inserted: unknown[] = [];
let rows: unknown[] = [{ id: "user-1" }];

mock.module("./db.ts", () => ({
  sql(_strings: TemplateStringsArray, ...values: unknown[]) {
    inserted = values;
    return Promise.resolve(rows);
  },
  dbTarget: () => "mock-db",
  waitForDb: () => Promise.resolve(),
  toVectorLiteral: (vec: number[]) => `[${vec.join(",")}]`,
}));

// Stub `arctic` so the OAuth start + callback flows run without hitting GitHub or
// Google. createAuthorizationURL builds a real URL (so location assertions hold);
// validateAuthorizationCode returns canned tokens and throws on the sentinel
// "bad-code" so the exchange-failure branch is reachable. Must precede the
// ./auth.ts import below (Bun applies module mocks at import time).
mock.module("arctic", () => {
  class GitHub {
    clientId: string;
    constructor(clientId: string, _clientSecret: string, _redirectUri: string) {
      this.clientId = clientId;
    }
    createAuthorizationURL(state: string, scopes: string[]): URL {
      const u = new URL("https://github.com/login/oauth/authorize");
      u.searchParams.set("client_id", this.clientId);
      u.searchParams.set("state", state);
      u.searchParams.set("scope", scopes.join(" "));
      return u;
    }
    validateAuthorizationCode(code: string): Promise<{ accessToken: () => string }> {
      if (code === "bad-code") return Promise.reject(new Error("invalid_grant"));
      return Promise.resolve({ accessToken: () => "gh-access-token" });
    }
  }
  class Google {
    clientId: string;
    constructor(clientId: string, _clientSecret: string, _redirectUri: string) {
      this.clientId = clientId;
    }
    createAuthorizationURL(state: string, _verifier: string, scopes: string[]): URL {
      const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      u.searchParams.set("client_id", this.clientId);
      u.searchParams.set("state", state);
      u.searchParams.set("scope", scopes.join(" "));
      u.searchParams.set("code_challenge_method", "S256");
      return u;
    }
    validateAuthorizationCode(code: string, _verifier: string): Promise<{ idToken: () => string }> {
      if (code === "bad-code") return Promise.reject(new Error("invalid_grant"));
      return Promise.resolve({ idToken: () => "google-id-token" });
    }
  }
  return {
    GitHub,
    Google,
    generateCodeVerifier: () => "test-code-verifier-0123456789",
    // Claims the google/callback flow decodes out of the (stubbed) id_token.
    decodeIdToken: () => ({
      sub: "google-sub-1",
      email: "grace@example.com",
      name: "Grace Hopper",
      picture: "https://avatar.example/grace.png",
    }),
  };
});

const { upsertUser, deleteAccount, handleAuth } = await import("./auth.ts");
const { config } = await import("./config.ts");
const { signSession, SESSION_COOKIE, STATE_COOKIE, VERIFIER_COOKIE } = await import("./session.ts");

afterAll(() => {
  mock.restore();
});

beforeEach(() => {
  inserted = [];
  rows = [{ id: "user-1" }];
});

describe("upsertUser", () => {
  it("upserts by provider identity and returns the session user", async () => {
    const user = await upsertUser(
      "github",
      "123",
      "ada@example.com",
      "Ada",
      "https://avatar.example/ada.png",
    );

    expect(user).toEqual({ id: "user-1", provider: "github" });
    expect(inserted).toEqual(["github", "123", "ada@example.com", "Ada", "https://avatar.example/ada.png", null]);
  });

  it("passes nullable OAuth profile fields through to SQL", async () => {
    const user = await upsertUser("google", "sub-1", null, null, null);

    expect(user).toEqual({ id: "user-1", provider: "google" });
    expect(inserted).toEqual(["google", "sub-1", null, null, null, null]);
  });
});

describe("deleteAccount", () => {
  it("issues a DELETE scoped to the given user id", async () => {
    await deleteAccount("user-1");
    expect(inserted).toEqual(["user-1"]);
  });
});

describe("provider route guards", () => {
  it("github start route 500s when GitHub isn't configured", async () => {
    const res = await handleAuth(new Request("http://x/api/auth/github", { method: "GET" }), "/api/auth/github");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "oauth_not_configured" });
  });

  it("google start route 500s when Google isn't configured", async () => {
    const res = await handleAuth(new Request("http://x/api/auth/google", { method: "GET" }), "/api/auth/google");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "oauth_not_configured" });
  });
});

// The start + callback flows need the provider gates open and a canonical appUrl
// to build redirect/callback URIs from. Mutating `config` (rather than mocking it)
// keeps session.ts working against the same object; originals are restored after.
describe("OAuth start routes", () => {
  const orig = {
    githubAuthEnabled: config.githubAuthEnabled,
    googleAuthEnabled: config.googleAuthEnabled,
    githubClientId: config.githubClientId,
    githubClientSecret: config.githubClientSecret,
    googleClientId: config.googleClientId,
    googleClientSecret: config.googleClientSecret,
    appUrl: config.appUrl,
  };
  beforeEach(() => {
    config.githubAuthEnabled = true;
    config.googleAuthEnabled = true;
    config.githubClientId = "gh-client";
    config.githubClientSecret = "gh-secret";
    config.googleClientId = "goog-client";
    config.googleClientSecret = "goog-secret";
    config.appUrl = "https://atlas.example";
  });
  afterAll(() => {
    Object.assign(config, orig);
  });

  it("redirects to GitHub with the state cookie set", async () => {
    const res = await handleAuth(new Request("http://x/api/auth/github", { method: "GET" }), "/api/auth/github");
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location")!);
    expect(location.host).toBe("github.com");
    expect(location.searchParams.get("client_id")).toBe("gh-client");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${STATE_COOKIE}=`);
    // The state echoed into the authorize URL must equal the one pinned in the cookie.
    const cookieState = /sky_oauth_state=([^;]+)/.exec(setCookie)?.[1];
    expect(cookieState).toBeDefined();
    expect(location.searchParams.get("state")).toBe(cookieState!);
  });

  it("redirects to Google with both the state and PKCE verifier cookies set", async () => {
    const res = await handleAuth(new Request("http://x/api/auth/google", { method: "GET" }), "/api/auth/google");
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location")!);
    expect(location.host).toBe("accounts.google.com");
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    // Both Set-Cookie headers ride on the 302 (state + PKCE code_verifier).
    const cookies = res.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith(`${STATE_COOKIE}=`))).toBe(true);
    expect(cookies.some((c) => c.startsWith(`${VERIFIER_COOKIE}=`))).toBe(true);
  });
});

// Drives the two callback handlers end-to-end with a stubbed arctic + a stubbed
// GitHub API (global fetch), asserting the state check, the user upsert, and the
// session cookie mint.
describe("OAuth callbacks", () => {
  const realFetch = globalThis.fetch;
  const orig = {
    appUrl: config.appUrl,
    jwtSecret: config.jwtSecret,
  };
  beforeEach(() => {
    config.appUrl = "https://atlas.example";
    config.jwtSecret = "test-secret-0123456789abcdef0123456789abcdef";
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  afterAll(() => {
    Object.assign(config, orig);
  });

  function callbackReq(sub: "github" | "google", params: string, cookie: string): Request {
    return new Request(`http://x/api/auth/${sub}/callback?${params}`, { method: "GET", headers: { cookie } });
  }

  describe("github/callback", () => {
    it("400s on a missing/mismatched state without exchanging the code", async () => {
      const res = await handleAuth(
        callbackReq("github", "code=abc&state=aaa", `${STATE_COOKIE}=bbb`),
        "/api/auth/github/callback",
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_oauth_state" });
      expect(res.headers.get("set-cookie")).toContain("Max-Age=0"); // state cleared
      expect(inserted).toEqual([]); // no upsert ran
    });

    it("exchanges the code, resolves a public email, upserts the user, sets the session", async () => {
      globalThis.fetch = ((url: unknown) => {
        expect(String(url)).toBe("https://api.github.com/user");
        return Promise.resolve(
          Response.json({ id: 42, login: "ada", name: "Ada Lovelace", avatar_url: "https://a/ada.png", email: "ada@github.example" }),
        );
      }) as unknown as typeof fetch;

      const res = await handleAuth(
        callbackReq("github", "code=good&state=s1", `${STATE_COOKIE}=s1`),
        "/api/auth/github/callback",
      );
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("https://atlas.example/");
      expect(inserted).toEqual(["github", "42", "ada@github.example", "Ada Lovelace", "https://a/ada.png", "ada"]);
      const cookies = res.headers.getSetCookie();
      expect(cookies.some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(true);
      expect(cookies.some((c) => c.startsWith(`${STATE_COOKIE}=`) && c.includes("Max-Age=0"))).toBe(true);
    });

    it("falls back to /user/emails when the profile email is private", async () => {
      globalThis.fetch = ((url: unknown) => {
        const u = String(url);
        if (u === "https://api.github.com/user") {
          return Promise.resolve(Response.json({ id: 7, login: "grace", name: null, avatar_url: "https://a/g.png", email: null }));
        }
        expect(u).toBe("https://api.github.com/user/emails");
        return Promise.resolve(
          Response.json([
            { email: "secondary@x.example", primary: false, verified: true },
            { email: "grace@primary.example", primary: true, verified: true },
          ]),
        );
      }) as unknown as typeof fetch;

      const res = await handleAuth(
        callbackReq("github", "code=good&state=s1", `${STATE_COOKIE}=s1`),
        "/api/auth/github/callback",
      );
      expect(res.status).toBe(302);
      // email resolved from /user/emails; name fell back to the login (name was null).
      expect(inserted).toEqual(["github", "7", "grace@primary.example", "grace", "https://a/g.png", "grace"]);
    });

    it("upserts a null email when the profile is private and /user/emails errors", async () => {
      globalThis.fetch = ((url: unknown) => {
        const u = String(url);
        if (u === "https://api.github.com/user") {
          return Promise.resolve(Response.json({ id: 9, login: "priv", name: "Priv", avatar_url: "https://a/p.png", email: null }));
        }
        // /user/emails is 403 (missing user:email scope) → ghFetch throws → resolveEmail swallows it.
        return Promise.resolve(new Response("forbidden", { status: 403 }));
      }) as unknown as typeof fetch;

      const res = await handleAuth(
        callbackReq("github", "code=good&state=s1", `${STATE_COOKIE}=s1`),
        "/api/auth/github/callback",
      );
      expect(res.status).toBe(302);
      expect(inserted).toEqual(["github", "9", null, "Priv", "https://a/p.png", "priv"]);
    });

    it("400s oauth_exchange_failed when the code exchange throws", async () => {
      const res = await handleAuth(
        callbackReq("github", "code=bad-code&state=s1", `${STATE_COOKIE}=s1`),
        "/api/auth/github/callback",
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "oauth_exchange_failed" });
      expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
    });
  });

  describe("google/callback", () => {
    it("400s when the PKCE verifier cookie is missing", async () => {
      const res = await handleAuth(
        callbackReq("google", "code=good&state=s1", `${STATE_COOKIE}=s1`),
        "/api/auth/google/callback",
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_oauth_state" });
      expect(inserted).toEqual([]);
    });

    it("exchanges the code with the verifier, decodes id_token claims, upserts, sets the session", async () => {
      const res = await handleAuth(
        callbackReq("google", "code=good&state=s1", `${STATE_COOKIE}=s1; ${VERIFIER_COOKIE}=v1`),
        "/api/auth/google/callback",
      );
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("https://atlas.example/");
      expect(inserted).toEqual([
        "google",
        "google-sub-1",
        "grace@example.com",
        "Grace Hopper",
        "https://avatar.example/grace.png",
        null,
      ]);
      const cookies = res.headers.getSetCookie();
      expect(cookies.some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(true);
      // Both OAuth round-trip cookies are cleared on success.
      expect(cookies.some((c) => c.startsWith(`${STATE_COOKIE}=`) && c.includes("Max-Age=0"))).toBe(true);
      expect(cookies.some((c) => c.startsWith(`${VERIFIER_COOKIE}=`) && c.includes("Max-Age=0"))).toBe(true);
    });

    it("400s oauth_exchange_failed when the code exchange throws", async () => {
      const res = await handleAuth(
        callbackReq("google", "code=bad-code&state=s1", `${STATE_COOKIE}=s1; ${VERIFIER_COOKIE}=v1`),
        "/api/auth/google/callback",
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "oauth_exchange_failed" });
      const cookies = res.headers.getSetCookie();
      expect(cookies.some((c) => c.startsWith(`${STATE_COOKIE}=`) && c.includes("Max-Age=0"))).toBe(true);
      expect(cookies.some((c) => c.startsWith(`${VERIFIER_COOKIE}=`) && c.includes("Max-Age=0"))).toBe(true);
    });
  });
});

describe("GET /api/auth/me", () => {
  const origSecret = config.jwtSecret;
  beforeEach(() => {
    config.jwtSecret = "test-secret-0123456789abcdef0123456789abcdef";
  });
  afterAll(() => {
    config.jwtSecret = origSecret;
  });

  it("401s when there is no session cookie", async () => {
    const res = await handleAuth(new Request("http://x/api/auth/me", { method: "GET" }), "/api/auth/me");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });

  it("returns the mapped profile for a signed-in user", async () => {
    rows = [{ id: "user-1", provider: "github", name: "Ada", avatar_url: "https://a/ada.png", email: "ada@x.example" }];
    const token = await signSession({ id: "user-1", provider: "github" });
    const req = new Request("http://x/api/auth/me", {
      method: "GET",
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    const res = await handleAuth(req, "/api/auth/me");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: "user-1",
      name: "Ada",
      avatarUrl: "https://a/ada.png",
      provider: "github",
      email: "ada@x.example",
    });
  });

  it("401s and clears the cookie when the session points at a deleted user", async () => {
    rows = []; // the users SELECT finds no row
    const token = await signSession({ id: "ghost", provider: "github" });
    const req = new Request("http://x/api/auth/me", {
      method: "GET",
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    const res = await handleAuth(req, "/api/auth/me");
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});

describe("POST /api/auth/signout", () => {
  it("clears the session cookie", async () => {
    const res = await handleAuth(new Request("http://x/api/auth/signout", { method: "POST" }), "/api/auth/signout");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});

describe("DELETE /api/auth/me", () => {
  // Sign a real session cookie via a scoped jwt secret (restored after) rather
  // than mocking session.ts — Bun module mocks are global and would leak.
  const origSecret = config.jwtSecret;
  beforeEach(() => {
    config.jwtSecret = "test-secret-0123456789abcdef0123456789abcdef";
  });
  afterAll(() => {
    config.jwtSecret = origSecret;
  });

  it("401s and runs no delete when there is no session", async () => {
    const res = await handleAuth(new Request("http://x/api/auth/me", { method: "DELETE" }), "/api/auth/me");
    expect(res.status).toBe(401);
    expect(inserted).toEqual([]); // no SQL touched the DB
  });

  it("deletes the signed-in user and clears the session cookie", async () => {
    const token = await signSession({ id: "user-1", provider: "github" });
    const req = new Request("http://x/api/auth/me", {
      method: "DELETE",
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    const res = await handleAuth(req, "/api/auth/me");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(inserted).toEqual(["user-1"]); // DELETE scoped to the session user
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0"); // cookie expired
  });
});

describe("unknown sub-route", () => {
  it("404s an unrecognized path", async () => {
    const res = await handleAuth(new Request("http://x/api/auth/nope", { method: "GET" }), "/api/auth/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("404s a known sub with the wrong method", async () => {
    const res = await handleAuth(new Request("http://x/api/auth/signout", { method: "GET" }), "/api/auth/signout");
    expect(res.status).toBe(404);
  });
});
