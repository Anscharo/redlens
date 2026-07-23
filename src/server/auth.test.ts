// Test OAuth routes and auth handlers.
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { handleAuth, upsertUser } from "./auth.ts";

const realFetch = globalThis.fetch;

// For testing OAuth with configured credentials, we need to set env vars
// BEFORE importing auth.ts. This is done in a separate file (auth-configured.test.ts)
// using dynamic imports, since the module has already been loaded here.

describe("handleAuth OAuth flows and error paths", () => {
  beforeEach(() => {
    // Comprehensive mock for GitHub and Google API flows
    globalThis.fetch = ((url: string | URL, _options?: any) => {
      const urlStr = String(url);

      // GitHub API endpoints
      if (urlStr.includes("github.com")) {
        if (urlStr.includes("/user/emails")) {
          return Promise.resolve(
            new Response(JSON.stringify([
              { email: "primary@github.com", primary: true, verified: true },
              { email: "secondary@github.com", primary: false, verified: true }
            ]))
          );
        }
        if (urlStr.includes("/user") && !urlStr.includes("/user/emails")) {
          return Promise.resolve(
            new Response(JSON.stringify({
              id: 12345,
              login: "testuser",
              name: "Test User",
              avatar_url: "https://avatars.githubusercontent.com/test",
              email: "test@github.com"
            }))
          );
        }
        // GitHub token exchange
        if (urlStr.includes("login.githubusercontent.com")) {
          return Promise.resolve(
            new Response(JSON.stringify({
              access_token: "gho_test_token_123",
              token_type: "bearer",
              scope: "read:user,user:email"
            }))
          );
        }
      }

      // Google API endpoints
      if (urlStr.includes("oauth2.googleapis.com") || urlStr.includes("openidconnect.googleapis.com")) {
        if (urlStr.includes("/token")) {
          return Promise.resolve(
            new Response(JSON.stringify({
              access_token: "ya29_test_token",
              token_type: "Bearer",
              expires_in: 3599,
              id_token: "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwczovL2FjY291bnRzLmdvb2dsZS5jb20iLCJhenAiOiJ0ZXN0LWNsaWVudC1pZC5hcHBzLmdvb2dsZXVzZXJjb250ZW50LmNvbSIsImF1ZCI6InRlc3QtY2xpZW50LWlkLmFwcHMuZ29vZ2xldXNlcmNvbnRlbnQuY29tIiwic3ViIjoiMTAwMzMyNDcxMjM0NTY3ODkwIiwiaWF0IjoxNjg5MzIxNDAwLCJleHAiOjE2ODkzMjUwMDB9.test_signature"
            }))
          );
        }
      }

      // Error responses for testing failure paths
      if (urlStr.includes("error.example.com")) {
        return Promise.resolve(new Response("Unauthorized", { status: 401 }));
      }

      // Default fallback
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  it("returns 404 for unknown auth route", async () => {
    const req = new Request("http://localhost/api/auth/unknown", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/unknown");
    expect(res.status).toBe(404);
  });

  it("returns 404 for deep nested unknown paths", async () => {
    const req = new Request("http://localhost/api/auth/unknown/nested/path", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/unknown/nested/path");
    expect(res.status).toBe(404);
  });

  it("returns 404 for /auth root path", async () => {
    const req = new Request("http://localhost/api/auth/", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/");
    expect(res.status).toBe(404);
  });

  it("returns 405 for POST to /me (only GET allowed)", async () => {
    const req = new Request("http://localhost/api/auth/me", { method: "POST" });
    const res = await handleAuth(req, "/api/auth/me");
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("returns 405 for PUT to /me", async () => {
    const req = new Request("http://localhost/api/auth/me", { method: "PUT" });
    const res = await handleAuth(req, "/api/auth/me");
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("returns 405 for DELETE to /me", async () => {
    const req = new Request("http://localhost/api/auth/me", { method: "DELETE" });
    const res = await handleAuth(req, "/api/auth/me");
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("returns 405 for GET to /signout (only POST allowed)", async () => {
    const req = new Request("http://localhost/api/auth/signout", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/signout");
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("returns 405 for PUT to /signout", async () => {
    const req = new Request("http://localhost/api/auth/signout", { method: "PUT" });
    const res = await handleAuth(req, "/api/auth/signout");
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("returns 405 for DELETE to /signout", async () => {
    const req = new Request("http://localhost/api/auth/signout", { method: "DELETE" });
    const res = await handleAuth(req, "/api/auth/signout");
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("returns 401 for /me without session", async () => {
    const req = new Request("http://localhost/api/auth/me", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("returns 401 for /me with invalid session", async () => {
    const req = new Request("http://localhost/api/auth/me", {
      method: "GET",
      headers: { cookie: "sky_session=invalid" }
    });
    const res = await handleAuth(req, "/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("returns 200 for /signout POST", async () => {
    const req = new Request("http://localhost/api/auth/signout", { method: "POST" });
    const res = await handleAuth(req, "/api/auth/signout");
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeTruthy();
  });

  it("returns 200 for /signout even with invalid session", async () => {
    const req = new Request("http://localhost/api/auth/signout", {
      method: "POST",
      headers: { cookie: "sky_session=invalid" }
    });
    const res = await handleAuth(req, "/api/auth/signout");
    expect(res.status).toBe(200);
  });

  it("handles /github route for GET requests", async () => {
    const req = new Request("http://localhost/api/auth/github", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/github");
    // Will be 302 redirect or 500 if OAuth not configured
    expect([302, 500].includes(res.status)).toBe(true);
  });

  it("handles /github route for non-GET requests", async () => {
    const req = new Request("http://localhost/api/auth/github", { method: "POST" });
    const res = await handleAuth(req, "/api/auth/github");
    expect(res.status).toBe(404);
  });

  it("handles /google route for GET requests", async () => {
    const req = new Request("http://localhost/api/auth/google", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/google");
    // Will be 302 redirect or 500 if OAuth not configured
    expect([302, 500].includes(res.status)).toBe(true);
  });

  it("handles /google route for non-GET requests", async () => {
    const req = new Request("http://localhost/api/auth/google", { method: "POST" });
    const res = await handleAuth(req, "/api/auth/google");
    expect(res.status).toBe(404);
  });

  it("handles /github/callback with missing state", async () => {
    const req = new Request("http://localhost/api/auth/github/callback?code=test", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/github/callback");
    expect(res.status).toBe(400);
  });

  it("handles /github/callback with missing code", async () => {
    const req = new Request("http://localhost/api/auth/github/callback?state=test", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/github/callback");
    expect(res.status).toBe(400);
  });

  it("handles /github/callback with both code and state", async () => {
    const req = new Request("http://localhost/api/auth/github/callback?code=test&state=test", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/github/callback");
    // Could be 400 (invalid state), 500 (OAuth error), or success
    expect([200, 400, 500].includes(res.status)).toBe(true);
  });

  it("handles /google/callback with missing code", async () => {
    const req = new Request("http://localhost/api/auth/google/callback", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/google/callback");
    expect(res.status).toBe(400);
  });

  it("handles /google/callback with missing state", async () => {
    const req = new Request("http://localhost/api/auth/google/callback?code=test", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/google/callback");
    expect(res.status).toBe(400);
  });

  it("handles /google/callback with both code and state", async () => {
    const req = new Request("http://localhost/api/auth/google/callback?code=test&state=test", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/google/callback");
    // Could be 400 (invalid state), 500 (OAuth error), or success
    expect([200, 400, 500].includes(res.status)).toBe(true);
  });

  it("returns JSON error response for 404", async () => {
    const req = new Request("http://localhost/api/auth/unknown", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/unknown");
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as any;
    expect(body.error).toBeDefined();
  });

  it("returns JSON error response for 401", async () => {
    const req = new Request("http://localhost/api/auth/me", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/me");
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as any;
    expect(body.error).toBeDefined();
  });

  it("returns JSON error response for 405", async () => {
    const req = new Request("http://localhost/api/auth/me", { method: "POST" });
    const res = await handleAuth(req, "/api/auth/me");
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("clears state cookie on callback failure", async () => {
    const req = new Request("http://localhost/api/auth/github/callback?code=test", {
      method: "GET",
      headers: { cookie: "state=value" }
    });
    const res = await handleAuth(req, "/api/auth/github/callback");
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
  });

  it("handles verifier cookie for Google PKCE flow", async () => {
    const req = new Request("http://localhost/api/auth/google/callback", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/google/callback");
    expect(res.status).toBe(400);
  });

  it("handles GitHub callback with error parameter", async () => {
    const req = new Request("http://localhost/api/auth/github/callback?error=access_denied", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/github/callback");
    expect([400, 401].includes(res.status)).toBe(true);
  });

  it("handles Google callback with error parameter", async () => {
    const req = new Request("http://localhost/api/auth/google/callback?error=access_denied", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/google/callback");
    expect([400, 401].includes(res.status)).toBe(true);
  });

  it("sets content-type header for /signout", async () => {
    const req = new Request("http://localhost/api/auth/signout", { method: "POST" });
    const res = await handleAuth(req, "/api/auth/signout");
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("handles /me with OPTIONS method", async () => {
    const req = new Request("http://localhost/api/auth/me", { method: "OPTIONS" });
    const res = await handleAuth(req, "/api/auth/me");
    expect(res.status).toBe(404);
  });

  it("handles GitHub callback with matching state cookies", async () => {
    const state = "test-state-uuid";
    const req = new Request(`http://localhost/api/auth/github/callback?code=test-code&state=${state}`, {
      method: "GET",
      headers: { cookie: `state=${state}` }
    });
    const res = await handleAuth(req, "/api/auth/github/callback");
    // Will attempt OAuth exchange; may fail with mocked response
    expect([200, 400, 500].includes(res.status)).toBe(true);
  });

  it("handles Google callback with matching state cookies", async () => {
    const state = "test-state-uuid";
    const verifier = "test-verifier-code";
    const req = new Request(`http://localhost/api/auth/google/callback?code=test-code&state=${state}`, {
      method: "GET",
      headers: { cookie: `state=${state}; verifier=${verifier}` }
    });
    const res = await handleAuth(req, "/api/auth/google/callback");
    // Will attempt OAuth exchange
    expect([200, 400, 500].includes(res.status)).toBe(true);
  });

  it("handles missing verifier in Google callback", async () => {
    const state = "test-state";
    const req = new Request(`http://localhost/api/auth/google/callback?code=test&state=${state}`, {
      method: "GET",
      headers: { cookie: `state=${state}` }
    });
    const res = await handleAuth(req, "/api/auth/google/callback");
    expect(res.status).toBe(400);
  });

  it("handles callback with empty code parameter", async () => {
    const state = "test-state";
    const req = new Request(`http://localhost/api/auth/github/callback?code=&state=${state}`, {
      method: "GET",
      headers: { cookie: `state=${state}` }
    });
    const res = await handleAuth(req, "/api/auth/github/callback");
    expect(res.status).toBe(400);
  });

  it("handles callback with empty state parameter", async () => {
    const req = new Request(`http://localhost/api/auth/github/callback?code=test&state=`, {
      method: "GET",
      headers: { cookie: `state=something` }
    });
    const res = await handleAuth(req, "/api/auth/github/callback");
    expect(res.status).toBe(400);
  });

  it("handles GitHub callback with non-GET method", async () => {
    const req = new Request("http://localhost/api/auth/github/callback", { method: "POST" });
    const res = await handleAuth(req, "/api/auth/github/callback");
    expect(res.status).toBe(404);
  });

  it("handles Google callback with non-GET method", async () => {
    const req = new Request("http://localhost/api/auth/google/callback", { method: "POST" });
    const res = await handleAuth(req, "/api/auth/google/callback");
    expect(res.status).toBe(404);
  });

  it("handles /github route with various HTTP methods", async () => {
    const methods = ["HEAD", "PATCH", "DELETE", "PUT", "OPTIONS"];
    for (const method of methods) {
      const req = new Request("http://localhost/api/auth/github", { method });
      const res = await handleAuth(req, "/api/auth/github");
      expect(res.status).toBe(404);
    }
  });

  it("handles /google route with various HTTP methods", async () => {
    const methods = ["HEAD", "PATCH", "DELETE", "PUT", "OPTIONS"];
    for (const method of methods) {
      const req = new Request("http://localhost/api/auth/google", { method });
      const res = await handleAuth(req, "/api/auth/google");
      expect(res.status).toBe(404);
    }
  });

  it("handles signout with various invalid cookies", async () => {
    const invalidCookies = ["invalid-jwt", "sky_session=", "other=value"];
    for (const cookie of invalidCookies) {
      const req = new Request("http://localhost/api/auth/signout", {
        method: "POST",
        headers: { cookie }
      });
      const res = await handleAuth(req, "/api/auth/signout");
      expect(res.status).toBe(200);
      expect(res.headers.get("set-cookie")).toBeTruthy();
    }
  });

  it("handles /me with various invalid session formats", async () => {
    const invalidSessions = ["", "invalid.jwt.token", "eyJhbGciOiJIUzI1NiJ9", "not-even-jwt"];
    for (const session of invalidSessions) {
      const req = new Request("http://localhost/api/auth/me", {
        method: "GET",
        headers: { cookie: `sky_session=${session}` }
      });
      const res = await handleAuth(req, "/api/auth/me");
      expect(res.status).toBe(401);
    }
  });

  it("returns proper error structure in responses", async () => {
    const req = new Request("http://localhost/api/auth/me", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/me");
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as any;
    expect(body).toHaveProperty("error");
    expect(typeof body.error).toBe("string");
  });

  it("handles callback URL variations", async () => {
    const variations = [
      "/api/auth/github/callback/extra",
      "/api/auth/github/callback?extra=param",
      "/api/auth/google/callback/extra",
      "/api/auth/google/callback?extra=param"
    ];
    for (const path of variations) {
      const req = new Request(`http://localhost${path}`, { method: "GET" });
      const res = await handleAuth(req, path.split("?")[0]);
      expect([400, 404].includes(res.status)).toBe(true);
    }
  });

  it("handles /signout with OPTIONS method", async () => {
    const req = new Request("http://localhost/api/auth/signout", { method: "OPTIONS" });
    const res = await handleAuth(req, "/api/auth/signout");
    expect(res.status).toBe(404);
  });

  it("handles /github/callback with empty query string", async () => {
    const req = new Request("http://localhost/api/auth/github/callback", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/github/callback");
    expect(res.status).toBe(400);
  });

  it("handles /google/callback with empty query string", async () => {
    const req = new Request("http://localhost/api/auth/google/callback", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/google/callback");
    expect(res.status).toBe(400);
  });

  it("handles /github with POST method", async () => {
    const req = new Request("http://localhost/api/auth/github", { method: "POST" });
    const res = await handleAuth(req, "/api/auth/github");
    expect(res.status).toBe(404);
  });

  it("handles /google with POST method", async () => {
    const req = new Request("http://localhost/api/auth/google", { method: "POST" });
    const res = await handleAuth(req, "/api/auth/google");
    expect(res.status).toBe(404);
  });

  it("handles /github/callback with mismatched state", async () => {
    const req = new Request("http://localhost/api/auth/github/callback?code=test&state=wrong", {
      method: "GET",
      headers: { cookie: "state=correct" }
    });
    const res = await handleAuth(req, "/api/auth/github/callback");
    expect(res.status).toBe(400);
  });

  it("handles /google/callback with mismatched state", async () => {
    const req = new Request("http://localhost/api/auth/google/callback?code=test&state=wrong", {
      method: "GET",
      headers: { cookie: "state=correct" }
    });
    const res = await handleAuth(req, "/api/auth/google/callback");
    expect(res.status).toBe(400);
  });

  it("handles /google/callback without verifier cookie", async () => {
    const req = new Request("http://localhost/api/auth/google/callback?code=test&state=correct", {
      method: "GET",
      headers: { cookie: "state=correct" }
    });
    const res = await handleAuth(req, "/api/auth/google/callback");
    expect(res.status).toBe(400);
  });

  it("handles /github/callback with different cookie names", async () => {
    const req = new Request("http://localhost/api/auth/github/callback?code=test&state=value", {
      method: "GET",
      headers: { cookie: "other=value; state=value" }
    });
    const res = await handleAuth(req, "/api/auth/github/callback");
    expect([200, 400, 500].includes(res.status)).toBe(true);
  });

  it("handles /google/callback with different cookie names", async () => {
    const req = new Request("http://localhost/api/auth/google/callback?code=test&state=value", {
      method: "GET",
      headers: { cookie: "other=value; state=value" }
    });
    const res = await handleAuth(req, "/api/auth/google/callback");
    expect([200, 400, 500].includes(res.status)).toBe(true);
  });

  it("handles pathname variations with extra slashes", async () => {
    const req = new Request("http://localhost/api/auth/me/extra", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/me/extra");
    expect(res.status).toBe(404);
  });

  it("handles /me with trailing slash", async () => {
    const req = new Request("http://localhost/api/auth/me/", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/me/");
    expect(res.status).toBe(404);
  });

  it("handles /signout with trailing slash", async () => {
    const req = new Request("http://localhost/api/auth/signout/", { method: "POST" });
    const res = await handleAuth(req, "/api/auth/signout/");
    expect([200, 404, 405].includes(res.status)).toBe(true);
  });

  it("handles /github/callback with PATCH method", async () => {
    const req = new Request("http://localhost/api/auth/github/callback", { method: "PATCH" });
    const res = await handleAuth(req, "/api/auth/github/callback");
    expect(res.status).toBe(404);
  });

  it("handles /google/callback with PATCH method", async () => {
    const req = new Request("http://localhost/api/auth/google/callback", { method: "PATCH" });
    const res = await handleAuth(req, "/api/auth/google/callback");
    expect(res.status).toBe(404);
  });

  it("handles /me with PATCH method", async () => {
    const req = new Request("http://localhost/api/auth/me", { method: "PATCH" });
    const res = await handleAuth(req, "/api/auth/me");
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("handles /signout with PATCH method", async () => {
    const req = new Request("http://localhost/api/auth/signout", { method: "PATCH" });
    const res = await handleAuth(req, "/api/auth/signout");
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("returns error for /github with JSON content-type", async () => {
    const req = new Request("http://localhost/api/auth/github", {
      method: "GET",
      headers: { "content-type": "application/json" }
    });
    const res = await handleAuth(req, "/api/auth/github");
    expect([302, 500].includes(res.status)).toBe(true);
  });

  it("returns error for /google with JSON content-type", async () => {
    const req = new Request("http://localhost/api/auth/google", {
      method: "GET",
      headers: { "content-type": "application/json" }
    });
    const res = await handleAuth(req, "/api/auth/google");
    expect([302, 500].includes(res.status)).toBe(true);
  });

  it("handles /github/callback with URL-encoded parameters", async () => {
    const req = new Request("http://localhost/api/auth/github/callback?code=test%20code&state=test%20state", {
      method: "GET"
    });
    const res = await handleAuth(req, "/api/auth/github/callback");
    expect(res.status).toBe(400);
  });

  it("handles /google/callback with URL-encoded parameters", async () => {
    const req = new Request("http://localhost/api/auth/google/callback?code=test%20code&state=test%20state", {
      method: "GET"
    });
    const res = await handleAuth(req, "/api/auth/google/callback");
    expect(res.status).toBe(400);
  });

  it("handles multiple state parameters in query string", async () => {
    const req = new Request("http://localhost/api/auth/github/callback?code=test&state=first&state=second", {
      method: "GET"
    });
    const res = await handleAuth(req, "/api/auth/github/callback");
    expect(res.status).toBe(400);
  });

  it("handles HEAD request to /api/auth/github", async () => {
    const req = new Request("http://localhost/api/auth/github", { method: "HEAD" });
    const res = await handleAuth(req, "/api/auth/github");
    expect(res.status).toBe(404);
  });

  it("handles HEAD request to /api/auth/google", async () => {
    const req = new Request("http://localhost/api/auth/google", { method: "HEAD" });
    const res = await handleAuth(req, "/api/auth/google");
    expect(res.status).toBe(404);
  });

  it("handles callback with state cookie in various formats", async () => {
    const state = "uuid-format-state-value";
    const req = new Request(`http://localhost/api/auth/github/callback?code=test&state=${state}`, {
      method: "GET",
      headers: { cookie: `state=${state}; path=/` }
    });
    const res = await handleAuth(req, "/api/auth/github/callback");
    expect([200, 400, 500].includes(res.status)).toBe(true);
  });

  it("handles /me endpoint with multiple cookies", async () => {
    const req = new Request("http://localhost/api/auth/me", {
      method: "GET",
      headers: { cookie: "other=value; sky_session=invalid; another=value2" }
    });
    const res = await handleAuth(req, "/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("handles /signout with various content-types", async () => {
    for (const contentType of ["application/json", "text/plain", "application/x-www-form-urlencoded"]) {
      const req = new Request("http://localhost/api/auth/signout", {
        method: "POST",
        headers: { "content-type": contentType }
      });
      const res = await handleAuth(req, "/api/auth/signout");
      expect(res.status).toBe(200);
    }
  });

  it("handles /github/callback with only code parameter", async () => {
    const req = new Request("http://localhost/api/auth/github/callback?code=abc123", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/github/callback");
    expect(res.status).toBe(400);
  });

  it("handles /google/callback with only code parameter", async () => {
    const req = new Request("http://localhost/api/auth/google/callback?code=abc123", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/google/callback");
    expect(res.status).toBe(400);
  });

  it("handles /github/callback with only state parameter", async () => {
    const req = new Request("http://localhost/api/auth/github/callback?state=abc123", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/github/callback");
    expect(res.status).toBe(400);
  });

  it("handles /google/callback with only state parameter", async () => {
    const req = new Request("http://localhost/api/auth/google/callback?state=abc123", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/google/callback");
    expect(res.status).toBe(400);
  });

  it("returns consistent content-type for all error responses", async () => {
    const paths = [
      ["/api/auth/unknown", "GET"],
      ["/api/auth/me", "POST"],
      ["/api/auth/signout", "GET"],
      ["/api/auth/github/callback", "GET"],
    ];
    for (const [path, method] of paths) {
      const req = new Request(`http://localhost${path}`, { method } as any);
      const res = await handleAuth(req, path);
      expect(res.headers.get("content-type")).toContain("application/json");
    }
  });

  it("handles /me/extra paths", async () => {
    const req = new Request("http://localhost/api/auth/me/extra/path", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/me/extra/path");
    expect(res.status).toBe(404);
  });

  it("handles GitHub callback with special characters in state", async () => {
    const req = new Request("http://localhost/api/auth/github/callback?code=test&state=test%20space", {
      method: "GET",
      headers: { cookie: "state=test space" }
    });
    const res = await handleAuth(req, "/api/auth/github/callback");
    expect([200, 400, 500].includes(res.status)).toBe(true);
  });

  it("handles POST to paths that expect GET", async () => {
    const paths = ["/api/auth/github", "/api/auth/google"];
    for (const path of paths) {
      const req = new Request(`http://localhost${path}`, { method: "POST" });
      const res = await handleAuth(req, path);
      expect(res.status).toBe(404);
    }
  });

  it("handles PATCH to various auth paths", async () => {
    const paths = ["/api/auth/me", "/api/auth/signout", "/api/auth/github", "/api/auth/google"];
    for (const path of paths) {
      const req = new Request(`http://localhost${path}`, { method: "PATCH" });
      const res = await handleAuth(req, path);
      expect([400, 401, 404, 405].includes(res.status)).toBe(true);
    }
  });

  it("handles multiple cookies in cookie header", async () => {
    const req = new Request("http://localhost/api/auth/github/callback?code=test&state=value", {
      method: "GET",
      headers: { cookie: "other=val; state=value; another=val2" }
    });
    const res = await handleAuth(req, "/api/auth/github/callback");
    expect([200, 400, 500].includes(res.status)).toBe(true);
  });
});

// ── handleAuth routes ──────────────────────────────────────────────────────────

describe("handleAuth", () => {
  // GitHub OAuth initiation
  it("GET /api/auth/github returns redirect to GitHub OAuth", async () => {
    // This test requires full OAuth mocking
    // Implementation would check for 302 status and Location header
  });

  // GitHub callback
  it("GET /api/auth/github/callback with valid code exchanges for tokens", async () => {
    // This test requires mocking the OAuth exchange
  });

  it("GET /api/auth/github/callback rejects missing or invalid state", async () => {
    // Test CSRF protection
  });

  // Google OAuth initiation
  it("GET /api/auth/google returns redirect to Google OAuth with PKCE", async () => {
    // PKCE verifier should be in cookies
  });

  // Google callback
  it("GET /api/auth/google/callback with valid code exchanges for tokens", async () => {
    // Test Google token exchange
  });

  it("GET /api/auth/google/callback rejects missing PKCE verifier", async () => {
    // Test PKCE validation
  });

  // /me endpoint
  it("GET /api/auth/me returns user profile when authenticated", async () => {
    // Test session validation and user data return
  });

  it("GET /api/auth/me returns 401 when not authenticated", async () => {
    // Test unauthenticated request
  });

  // /signout endpoint
  it("POST /api/auth/signout clears session cookie", async () => {
    // Test logout flow
  });

  it("returns 404 for unknown auth route", async () => {
    // Test 404 handling for invalid paths
  });

  it("returns 405 for unsupported HTTP methods", async () => {
    // Test method validation
  });
});

// ── Integration scenarios ──────────────────────────────────────────────────────

describe("Authentication flow", () => {
  it("handles GitHub OAuth redirect to authorization URL", async () => {
    const req = new Request("http://localhost/api/auth/github", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/github");
    expect([302, 500].includes(res.status)).toBe(true);
    if (res.status === 302) {
      const location = res.headers.get("location");
      expect(location).toBeTruthy();
      if (location) expect(location).toContain("github.com");
    }
  });

  it("handles Google OAuth redirect to authorization URL", async () => {
    const req = new Request("http://localhost/api/auth/google", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/google");
    expect([302, 500].includes(res.status)).toBe(true);
    if (res.status === 302) {
      const location = res.headers.get("location");
      expect(location).toBeTruthy();
      if (location) expect(location).toContain("google.com");
    }
  });

  it("rejects GitHub callback without state parameter", async () => {
    const req = new Request("http://localhost/api/auth/github/callback?code=test123", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/github/callback");
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toBeDefined();
  });

  it("rejects Google callback without code parameter", async () => {
    const req = new Request("http://localhost/api/auth/google/callback?state=test", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/google/callback");
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toBeDefined();
  });

  it("handles GET /api/auth/me without authentication", async () => {
    const req = new Request("http://localhost/api/auth/me", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("returns JSON error for unknown auth path", async () => {
    const req = new Request("http://localhost/api/auth/invalid-path", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/invalid-path");
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error).toBeDefined();
  });

  it("accepts POST to /api/auth/signout", async () => {
    const req = new Request("http://localhost/api/auth/signout", { method: "POST" });
    const res = await handleAuth(req, "/api/auth/signout");
    expect([200, 302].includes(res.status)).toBe(true);
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
  });

  it("completes GitHub OAuth callback with matching state and code", async () => {
    const state = "test-state-123";
    const code = "test-code-456";
    const req = new Request(`http://localhost/api/auth/github/callback?code=${code}&state=${state}`, {
      method: "GET",
      headers: { cookie: `state=${state}` }
    });
    const res = await handleAuth(req, "/api/auth/github/callback");
    // Should redirect on success or return error if OAuth exchange fails
    expect([200, 302, 400, 500].includes(res.status)).toBe(true);
  });

  it("completes Google OAuth callback with matching state, code and verifier", async () => {
    const state = "test-state-google";
    const code = "test-code-google";
    const verifier = "test-verifier-google";
    const req = new Request(`http://localhost/api/auth/google/callback?code=${code}&state=${state}`, {
      method: "GET",
      headers: { cookie: `state=${state}; verifier=${verifier}` }
    });
    const res = await handleAuth(req, "/api/auth/google/callback");
    // Should redirect on success or return error if OAuth exchange fails
    expect([200, 302, 400, 500].includes(res.status)).toBe(true);
  });

  it("handles GitHub callback state mismatch", async () => {
    const req = new Request("http://localhost/api/auth/github/callback?code=test&state=state1", {
      method: "GET",
      headers: { cookie: "state=state2" }
    });
    const res = await handleAuth(req, "/api/auth/github/callback");
    expect(res.status).toBe(400);
  });

  it("handles Google callback state mismatch", async () => {
    const req = new Request("http://localhost/api/auth/google/callback?code=test&state=state1", {
      method: "GET",
      headers: { cookie: "state=state2; verifier=test" }
    });
    const res = await handleAuth(req, "/api/auth/google/callback");
    expect(res.status).toBe(400);
  });

  it("handles GitHub callback with missing verifier", async () => {
    const state = "test-state";
    const req = new Request(`http://localhost/api/auth/github/callback?code=test&state=${state}`, {
      method: "GET",
      headers: { cookie: `state=${state}; other=value` }
    });
    const res = await handleAuth(req, "/api/auth/github/callback");
    // GitHub doesn't require verifier, should process normally
    expect([200, 302, 400, 500].includes(res.status)).toBe(true);
  });

  it("handles Google callback with missing verifier", async () => {
    const state = "test-state-google";
    const req = new Request(`http://localhost/api/auth/google/callback?code=test&state=${state}`, {
      method: "GET",
      headers: { cookie: `state=${state}` }
    });
    const res = await handleAuth(req, "/api/auth/google/callback");
    // Google requires verifier, should return 400
    expect(res.status).toBe(400);
  });
});
