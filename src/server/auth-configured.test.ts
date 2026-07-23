// Test OAuth routes with configured credentials (environment variables set).
// This file uses dynamic imports to test auth.ts with actual config values.
import { describe, it, expect, beforeEach, afterEach } from "bun:test";

// Set environment variables before importing auth
process.env.GITHUB_CLIENT_ID = "test-github-id-configured";
process.env.GITHUB_CLIENT_SECRET = "test-github-secret-configured";
process.env.GOOGLE_CLIENT_ID = "test-google-id-configured";
process.env.GOOGLE_CLIENT_SECRET = "test-google-secret-configured";
process.env.APP_URL = "http://localhost:5173";

// Dynamic import with config values set
const { handleAuth } = await import("./auth.ts");

const realFetch = globalThis.fetch;

describe("OAuth with configured credentials", () => {
  beforeEach(() => {
    // Mock fetch to simulate OAuth endpoints
    globalThis.fetch = ((url: string | URL, options?: any) => {
      const urlStr = String(url);

      // GitHub OAuth token endpoint
      if (urlStr.includes("github.com/login/oauth/access_token")) {
        return Promise.resolve(
          new Response(JSON.stringify({
            access_token: "gho_test_token_configured",
            token_type: "bearer",
            scope: "read:user,user:email"
          }), {
            headers: { "content-type": "application/json" }
          })
        );
      }

      // GitHub API user endpoint
      if (urlStr.includes("api.github.com/user") && !urlStr.includes("/user/emails")) {
        return Promise.resolve(
          new Response(JSON.stringify({
            id: 99999,
            login: "configured-user",
            name: "Configured User",
            avatar_url: "https://avatars.githubusercontent.com/configured",
            email: "configured@github.com"
          }), {
            headers: { "content-type": "application/json" }
          })
        );
      }

      // GitHub API emails endpoint
      if (urlStr.includes("api.github.com/user/emails")) {
        return Promise.resolve(
          new Response(JSON.stringify([
            { email: "configured-primary@github.com", primary: true, verified: true }
          ]), {
            headers: { "content-type": "application/json" }
          })
        );
      }

      // Google OAuth token endpoint
      if (urlStr.includes("oauth2.googleapis.com/token")) {
        return Promise.resolve(
          new Response(JSON.stringify({
            access_token: "ya29_configured_token",
            token_type: "Bearer",
            expires_in: 3599,
            id_token: "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwczovL2FjY291bnRzLmdvb2dsZS5jb20iLCJhenAiOiJ0ZXN0LWNsaWVudC1pZC5hcHBzLmdvb2dsZXVzZXJjb250ZW50LmNvbSIsImF1ZCI6InRlc3QtY2xpZW50LWlkLmFwcHMuZ29vZ2xldXNlcmNvbnRlbnQuY29tIiwic3ViIjoiY29uZmlndXJlZC1zdWIiLCJuYW1lIjoiQ29uZmlndXJlZCBVc2VyIiwiZW1haWwiOiJjb25maWd1cmVkQGdtYWlsLmNvbSIsInBpY3R1cmUiOiJodHRwczovL2V4YW1wbGUuY29tL2NvbmZpZ3VyZWQucG5nIiwiaWF0IjoxNjg5MzIxNDAwLCJleHAiOjE2ODkzMjUwMDB9.configured_signature"
          }), {
            headers: { "content-type": "application/json" }
          })
        );
      }

      // Default fallback
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("GET /api/auth/github returns redirect (config is set)", async () => {
    const req = new Request("http://localhost/api/auth/github", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/github");
    // With config set, should redirect to GitHub OAuth
    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).toBeTruthy();
    expect(String(location)).toContain("github.com");
  });

  it("GET /api/auth/github sets state cookie", async () => {
    const req = new Request("http://localhost/api/auth/github", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/github");
    expect(res.status).toBe(302);
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    expect(String(setCookie)).toContain("state=");
  });

  it("GET /api/auth/google returns redirect (config is set)", async () => {
    const req = new Request("http://localhost/api/auth/google", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/google");
    // With config set, should redirect to Google OAuth
    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).toBeTruthy();
    expect(String(location)).toContain("google.com");
  });

  it("GET /api/auth/google sets state and verifier cookies", async () => {
    const req = new Request("http://localhost/api/auth/google", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/google");
    expect(res.status).toBe(302);
    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get("set-cookie") || ""];
    const cookieString = setCookies.join("; ");
    expect(cookieString).toContain("state=");
  });

  it("github redirect includes configured redirect URI", async () => {
    const req = new Request("http://localhost/api/auth/github", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/github");
    const location = res.headers.get("location");
    if (location) {
      expect(String(location)).toContain("5173");
      expect(String(location)).toContain("github.com");
      expect(String(location)).toContain("test-github-id-configured");
    }
  });

  it("google redirect includes configured redirect URI", async () => {
    const req = new Request("http://localhost/api/auth/google", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/google");
    const location = res.headers.get("location");
    if (location) {
      expect(String(location)).toContain("5173");
      expect(String(location)).toContain("google.com");
      expect(String(location)).toContain("test-google-id-configured");
    }
  });
});
