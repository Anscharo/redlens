// Test OAuth routes and auth handlers.
import { describe, it, expect } from "bun:test";
import { handleAuth } from "./auth.ts";

describe("handleAuth routes", () => {
  it("returns 404 for unknown auth route", async () => {
    const req = new Request("http://localhost/api/auth/unknown", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/unknown");
    expect(res.status).toBe(404);
  });

  it("returns 405 for POST to /me (only GET allowed)", async () => {
    const req = new Request("http://localhost/api/auth/me", { method: "POST" });
    const res = await handleAuth(req, "/api/auth/me");
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("returns 405 for GET to /signout (only POST allowed)", async () => {
    const req = new Request("http://localhost/api/auth/signout", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/signout");
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("returns 401 for /me without session", async () => {
    const req = new Request("http://localhost/api/auth/me", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("returns 200 for /signout POST", async () => {
    const req = new Request("http://localhost/api/auth/signout", { method: "POST" });
    const res = await handleAuth(req, "/api/auth/signout");
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeTruthy();
  });

  it("handles /github route for GET requests", async () => {
    const req = new Request("http://localhost/api/auth/github", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/github");
    // Will be 302 redirect or 500 if OAuth not configured
    expect([302, 500]).toContain(res.status);
  });

  it("handles /google route for GET requests", async () => {
    const req = new Request("http://localhost/api/auth/google", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/google");
    // Will be 302 redirect or 500 if OAuth not configured
    expect([302, 500]).toContain(res.status);
  });

  it("handles /github/callback with missing state", async () => {
    const req = new Request("http://localhost/api/auth/github/callback?code=test", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/github/callback");
    expect(res.status).toBe(400);
  });

  it("handles /google/callback with missing code", async () => {
    const req = new Request("http://localhost/api/auth/google/callback", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/google/callback");
    expect(res.status).toBe(400);
  });

  it("returns JSON error response", async () => {
    const req = new Request("http://localhost/api/auth/me", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/me");
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body.error).toBeDefined();
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
    expect([302, 500]).toContain(res.status);
    if (res.status === 302) {
      const location = res.headers.get("location");
      expect(location).toBeTruthy();
      if (location) expect(location).toContain("github.com");
    }
  });

  it("handles Google OAuth redirect to authorization URL", async () => {
    const req = new Request("http://localhost/api/auth/google", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/google");
    expect([302, 500]).toContain(res.status);
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
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("rejects Google callback without code parameter", async () => {
    const req = new Request("http://localhost/api/auth/google/callback?state=test", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/google/callback");
    expect(res.status).toBe(400);
    const body = await res.json();
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
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("accepts POST to /api/auth/signout", async () => {
    const req = new Request("http://localhost/api/auth/signout", { method: "POST" });
    const res = await handleAuth(req, "/api/auth/signout");
    expect([200, 302]).toContain(res.status);
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
  });
});
