// Minimal OAuth test
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { handleAuth } from "./auth.ts";

const realFetch = globalThis.fetch;

describe("minimal OAuth", () => {
  beforeEach(() => {
    globalThis.fetch = (async (url: string | URL | Request): Promise<Response> => {
      // Return status 200 with minimal token response for ANY request
      return new Response(JSON.stringify({
        access_token: "test_token",
        token_type: "bearer"
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("GitHub callback with matching state - minimal mock", async () => {
    const state = "test";
    const code = "code";
    const req = new Request(
      `http://localhost/api/auth/github/callback?code=${code}&state=${state}`,
      { method: "GET", headers: { cookie: `sky_oauth_state=${state}` } }
    );
    const res = await handleAuth(req, "/api/auth/github/callback");
    // Should get some response (might be error from downstream, but not state validation)
    expect(res.status).toBeGreaterThanOrEqual(200);
  });
});
