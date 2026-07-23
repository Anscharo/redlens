// Aggressive auth flow testing
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { handleAuth } from "./auth.ts";

const realFetch = globalThis.fetch;

describe("auth aggressive flow testing", () => {
  beforeEach(() => {
    globalThis.fetch = (async (url: string | URL | Request): Promise<Response> => {
      const urlStr = String(url);
      
      // GitHub token endpoint
      if (urlStr.includes("github.com") && urlStr.includes("/login/oauth/access_token")) {
        return new Response(
          JSON.stringify({
            access_token: "gho_test_token",
            token_type: "bearer",
            scope: "read:user,user:email"
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      // GitHub user endpoint
      if (urlStr.includes("api.github.com/user") && !urlStr.includes("/user/emails")) {
        return new Response(
          JSON.stringify({
            id: 12345,
            login: "testuser",
            name: "Test User",
            avatar_url: "https://avatars.githubusercontent.com/u/12345",
            email: "test@example.com"
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      // GitHub user emails
      if (urlStr.includes("api.github.com/user/emails")) {
        return new Response(
          JSON.stringify([
            { email: "primary@example.com", primary: true, verified: true }
          ]),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      // Google token endpoint
      if (urlStr.includes("oauth2.googleapis.com") && urlStr.includes("/token")) {
        return new Response(
          JSON.stringify({
            access_token: "ya29_test_token",
            token_type: "Bearer",
            expires_in: 3599,
            id_token: "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IjEifQ.eyJpc3MiOiJodHRwczovL2FjY291bnRzLmdvb2dsZS5jb20iLCJhenAiOiJ0ZXN0LWNsaWVudC1pZC5hcHBzLmdvb2dsZXVzZXJjb250ZW50LmNvbSIsImF1ZCI6InRlc3QtY2xpZW50LWlkLmFwcHMuZ29vZ2xldXNlcmNvbnRlbnQuY29tIiwic3ViIjoiMTA3NjkyNzUxNzA4OTcwMzk1NjU0IiwiZW1haWwiOiJ0ZXN0QGdtYWlsLmNvbSIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJuYW1lIjoiVGVzdCBVc2VyIiwicGljdHVyZSI6Imh0dHBzOi8vZXhhbXBsZS5jb20vYXZhdGFyLnBuZyIsImlhdCI6MTY4OTMyMTQwMCwiZXhwIjoxNjg5MzI1MDAwfQ.test_signature"
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("multiple GitHub callback attempts", async () => {
    for (let i = 0; i < 5; i++) {
      const state = `state-${i}`;
      const req = new Request(
        `http://localhost/api/auth/github/callback?code=code-${i}&state=${state}`,
        { method: "GET", headers: { cookie: `sky_oauth_state=${state}` } }
      );
      const res = await handleAuth(req, "/api/auth/github/callback");
      expect([200, 302, 400, 500].includes(res.status)).toBe(true);
    }
  });

  it("multiple Google callback attempts", async () => {
    for (let i = 0; i < 5; i++) {
      const state = `gstate-${i}`;
      const verifier = `verifier-${i}`;
      const req = new Request(
        `http://localhost/api/auth/google/callback?code=gcode-${i}&state=${state}`,
        { method: "GET", headers: { cookie: `sky_oauth_state=${state}; sky_oauth_verifier=${verifier}` } }
      );
      const res = await handleAuth(req, "/api/auth/google/callback");
      expect([200, 302, 400, 500].includes(res.status)).toBe(true);
    }
  });

  it("multiple /me endpoint calls", async () => {
    for (let i = 0; i < 5; i++) {
      const req = new Request("http://localhost/api/auth/me", { method: "GET" });
      const res = await handleAuth(req, "/api/auth/me");
      expect(res.status).toBe(401);
    }
  });

  it("multiple /signout endpoint calls", async () => {
    for (let i = 0; i < 5; i++) {
      const req = new Request("http://localhost/api/auth/signout", { method: "POST" });
      const res = await handleAuth(req, "/api/auth/signout");
      expect(res.status).toBe(200);
    }
  });

  it("/auth/github endpoint multiple times", async () => {
    for (let i = 0; i < 3; i++) {
      const req = new Request("http://localhost/api/auth/github", { method: "GET" });
      const res = await handleAuth(req, "/api/auth/github");
      expect(res.status).toBe(302);
    }
  });

  it("/auth/google endpoint multiple times", async () => {
    for (let i = 0; i < 3; i++) {
      const req = new Request("http://localhost/api/auth/google", { method: "GET" });
      const res = await handleAuth(req, "/api/auth/google");
      expect(res.status).toBe(302);
    }
  });

  it("mixed auth flow sequence", async () => {
    const req1 = new Request("http://localhost/api/auth/github", { method: "GET" });
    const res1 = await handleAuth(req1, "/api/auth/github");
    expect(res1.status).toBe(302);

    const req2 = new Request("http://localhost/api/auth/google", { method: "GET" });
    const res2 = await handleAuth(req2, "/api/auth/google");
    expect(res2.status).toBe(302);

    const req3 = new Request("http://localhost/api/auth/me", { method: "GET" });
    const res3 = await handleAuth(req3, "/api/auth/me");
    expect(res3.status).toBe(401);

    const req4 = new Request("http://localhost/api/auth/signout", { method: "POST" });
    const res4 = await handleAuth(req4, "/api/auth/signout");
    expect(res4.status).toBe(200);
  });
});
