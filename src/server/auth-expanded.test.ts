// Expanded auth tests focusing on testable paths
import { describe, it, expect } from "bun:test";
import { handleAuth } from "./auth.ts";

describe("handleAuth expanded coverage", () => {
  it("returns 400 when missing both code and state", async () => {
    const req = new Request("http://localhost/api/auth/github/callback", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/github/callback");
    expect(res.status).toBe(400);
  });

  it("returns 400 when code present but state missing", async () => {
    const req = new Request("http://localhost/api/auth/github/callback?code=abc", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/github/callback");
    expect(res.status).toBe(400);
  });

  it("returns 400 when state present but code missing", async () => {
    const req = new Request("http://localhost/api/auth/github/callback?state=xyz", {
      method: "GET",
      headers: { cookie: "sky_oauth_state=xyz" }
    });
    const res = await handleAuth(req, "/api/auth/github/callback");
    expect(res.status).toBe(400);
  });

  it("returns 400 when state parameter empty", async () => {
    const req = new Request("http://localhost/api/auth/github/callback?code=abc&state=", {
      method: "GET",
      headers: { cookie: "sky_oauth_state=something" }
    });
    const res = await handleAuth(req, "/api/auth/github/callback");
    expect(res.status).toBe(400);
  });

  it("returns 400 when code parameter empty", async () => {
    const req = new Request("http://localhost/api/auth/github/callback?code=&state=test", {
      method: "GET",
      headers: { cookie: "sky_oauth_state=test" }
    });
    const res = await handleAuth(req, "/api/auth/github/callback");
    expect(res.status).toBe(400);
  });

  it("returns 400 when state mismatch in URL vs cookie", async () => {
    const req = new Request("http://localhost/api/auth/github/callback?code=abc&state=url_state", {
      method: "GET",
      headers: { cookie: "sky_oauth_state=cookie_state" }
    });
    const res = await handleAuth(req, "/api/auth/github/callback");
    expect(res.status).toBe(400);
  });

  it("returns 400 when state in URL but missing in cookie", async () => {
    const req = new Request("http://localhost/api/auth/github/callback?code=abc&state=test_state", {
      method: "GET",
      headers: { cookie: "other_cookie=value; sky_oauth_state=" }
    });
    const res = await handleAuth(req, "/api/auth/github/callback");
    expect(res.status).toBe(400);
  });

  // Google callback tests
  it("returns 400 when missing code in Google callback", async () => {
    const req = new Request("http://localhost/api/auth/google/callback", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/google/callback");
    expect(res.status).toBe(400);
  });

  it("returns 400 when missing state in Google callback", async () => {
    const req = new Request("http://localhost/api/auth/google/callback?code=abc", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/google/callback");
    expect(res.status).toBe(400);
  });

  it("returns 400 when missing verifier in Google callback", async () => {
    const state = "test_state";
    const req = new Request(`http://localhost/api/auth/google/callback?code=abc&state=${state}`, {
      method: "GET",
      headers: { cookie: `sky_oauth_state=${state}` }
    });
    const res = await handleAuth(req, "/api/auth/google/callback");
    expect(res.status).toBe(400);
  });

  it("returns 400 when state mismatch in Google callback", async () => {
    const req = new Request("http://localhost/api/auth/google/callback?code=abc&state=url_state", {
      method: "GET",
      headers: { cookie: "sky_oauth_state=cookie_state; sky_oauth_verifier=test" }
    });
    const res = await handleAuth(req, "/api/auth/google/callback");
    expect(res.status).toBe(400);
  });

  it("returns 400 when verifier missing but state matches", async () => {
    const state = "test_state";
    const req = new Request(`http://localhost/api/auth/google/callback?code=abc&state=${state}`, {
      method: "GET",
      headers: { cookie: `sky_oauth_state=${state}; other=value` }
    });
    const res = await handleAuth(req, "/api/auth/google/callback");
    expect(res.status).toBe(400);
  });

  // Error parameter tests
  it("returns error status when GitHub error parameter present", async () => {
    const req = new Request("http://localhost/api/auth/github/callback?error=access_denied", {
      method: "GET"
    });
    const res = await handleAuth(req, "/api/auth/github/callback");
    expect([400, 401].includes(res.status)).toBe(true);
  });

  it("returns error status when Google error parameter present", async () => {
    const req = new Request("http://localhost/api/auth/google/callback?error=access_denied", {
      method: "GET"
    });
    const res = await handleAuth(req, "/api/auth/google/callback");
    expect([400, 401].includes(res.status)).toBe(true);
  });

  // /me endpoint tests
  it("returns 401 when /me called without session", async () => {
    const req = new Request("http://localhost/api/auth/me", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("returns 401 when /me called with invalid session cookie", async () => {
    const req = new Request("http://localhost/api/auth/me", {
      method: "GET",
      headers: { cookie: "sky_session=invalid.jwt.token" }
    });
    const res = await handleAuth(req, "/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("returns 401 when /me called with malformed JWT", async () => {
    const req = new Request("http://localhost/api/auth/me", {
      method: "GET",
      headers: { cookie: "sky_session=not.a.jwt" }
    });
    const res = await handleAuth(req, "/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("returns 401 when /me called with empty session cookie", async () => {
    const req = new Request("http://localhost/api/auth/me", {
      method: "GET",
      headers: { cookie: "sky_session=" }
    });
    const res = await handleAuth(req, "/api/auth/me");
    expect(res.status).toBe(401);
  });

  // /signout endpoint tests
  it("returns 200 for /signout POST", async () => {
    const req = new Request("http://localhost/api/auth/signout", { method: "POST" });
    const res = await handleAuth(req, "/api/auth/signout");
    expect(res.status).toBe(200);
  });

  it("sets clear session cookie on /signout", async () => {
    const req = new Request("http://localhost/api/auth/signout", { method: "POST" });
    const res = await handleAuth(req, "/api/auth/signout");
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
  });

  it("returns 404 for /signout with GET method", async () => {
    const req = new Request("http://localhost/api/auth/signout", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/signout");
    expect(res.status).toBe(404);
  });

  // Response format tests
  it("returns JSON for all error responses", async () => {
    const req = new Request("http://localhost/api/auth/unknown", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/unknown");
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("returns JSON for /me 401", async () => {
    const req = new Request("http://localhost/api/auth/me", { method: "GET" });
    const res = await handleAuth(req, "/api/auth/me");
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json() as any;
    expect(body.error).toBeDefined();
  });

  it("returns JSON for /signout POST", async () => {
    const req = new Request("http://localhost/api/auth/signout", { method: "POST" });
    const res = await handleAuth(req, "/api/auth/signout");
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
  });
});
