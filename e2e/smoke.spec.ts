import { test, expect } from "@playwright/test";

// First E2E spec — the ci.yml curl smoke, ported to run against the live Railway
// PR environment (real Docker image, real workers, real DB). These two checks
// prove the deploy is actually up and serving before any UI specs run:
//   1. /api/health   — process is up and its Postgres is reachable
//   2. POST /mcp      — the MCP server is wired and exposing the atlas tools
// Both are root-path API routes, so they're independent of the SPA base path.

test.describe("deploy smoke", () => {
  test("GET /api/health reports a reachable DB", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    // status is a derived enum (ok/syncing/stale/…) that can be non-"ok" on a
    // healthy box; assert DB reachability rather than the status string.
    expect(body.db_reachable).toBe(true);
  });

  test("POST /mcp tools/list exposes the atlas tools", async ({ request }) => {
    const res = await request.post("/mcp", {
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
      },
      data: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    });
    expect(res.ok()).toBeTruthy();
    // The streamable-HTTP transport may answer as SSE; assert on the raw text.
    const text = await res.text();
    expect(text).toContain("atlas_query");
  });
});
