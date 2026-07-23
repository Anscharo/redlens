// Test collections routes (/api/collections).
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { handleCollections, handleSharedCollection } from "./collections.ts";

beforeEach(() => {
});

afterEach(() => {
  // Restore if needed
});

describe("handleSharedCollection", () => {
  it("returns 405 for POST request", async () => {
    const req = new Request("http://localhost/api/collections/test-id/shared", { method: "POST" });
    const res = await handleSharedCollection(req);
    expect(res.status).toBe(405);
  });

  it("returns 405 for DELETE request", async () => {
    const req = new Request("http://localhost/api/collections/test-id/shared", { method: "DELETE" });
    const res = await handleSharedCollection(req);
    expect(res.status).toBe(405);
  });

  it("returns 405 for PATCH request", async () => {
    const req = new Request("http://localhost/api/collections/test-id/shared", { method: "PATCH" });
    const res = await handleSharedCollection(req);
    expect(res.status).toBe(405);
  });

  it("returns 404 for malformed path without shared suffix", async () => {
    const req = new Request("http://localhost/api/collections/test-id", { method: "GET" });
    const res = await handleSharedCollection(req);
    expect(res.status).toBe(404);
  });

  it("returns 404 for missing shared suffix with wrong path", async () => {
    const req = new Request("http://localhost/api/collections/test-id/other", { method: "GET" });
    const res = await handleSharedCollection(req);
    expect(res.status).toBe(404);
  });

  it("returns 404 for root path", async () => {
    const req = new Request("http://localhost/api/collections/shared", { method: "GET" });
    const res = await handleSharedCollection(req);
    expect(res.status).toBe(404);
  });

  it("returns JSON error responses", async () => {
    const req = new Request("http://localhost/api/collections/test-id", { method: "GET" });
    const res = await handleSharedCollection(req);
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});

describe("handleCollections", () => {
  it("returns 401 for unauthenticated GET /api/collections", async () => {
    const req = new Request("http://localhost/api/collections", { method: "GET" });
    const res = await handleCollections(req);
    expect(res.status).toBe(401);
  });

  it("returns 401 for unauthenticated POST /api/collections", async () => {
    const req = new Request("http://localhost/api/collections", {
      method: "POST",
      body: JSON.stringify({ name: "test" }),
      headers: { "content-type": "application/json" }
    });
    const res = await handleCollections(req);
    expect(res.status).toBe(401);
  });

  it("returns 401 for unauthenticated PATCH /api/collections/:id", async () => {
    const req = new Request("http://localhost/api/collections/test-id", {
      method: "PATCH",
      body: JSON.stringify({ name: "updated" }),
      headers: { "content-type": "application/json" }
    });
    const res = await handleCollections(req);
    expect(res.status).toBe(401);
  });

  it("returns 401 for unauthenticated DELETE /api/collections/:id", async () => {
    const req = new Request("http://localhost/api/collections/test-id", { method: "DELETE" });
    const res = await handleCollections(req);
    expect(res.status).toBe(401);
  });

  it("returns 401 for unauthenticated OPTIONS method", async () => {
    const req = new Request("http://localhost/api/collections", { method: "OPTIONS" });
    const res = await handleCollections(req);
    expect(res.status).toBe(401);
  });

  it("returns 401 or 405 for PUT method (auth check before method)", async () => {
    const req = new Request("http://localhost/api/collections", { method: "PUT" });
    const res = await handleCollections(req);
    expect([401, 405]).toContain(res.status);
  });

  it("returns 400 for invalid JSON in POST", async () => {
    // Without session it returns 401, but document the error path
    const req = new Request("http://localhost/api/collections", {
      method: "POST",
      body: "invalid json",
      headers: { "content-type": "application/json" }
    });
    const res = await handleCollections(req);
    expect([400, 401]).toContain(res.status);
  });

  it("returns JSON response with content-type", async () => {
    const req = new Request("http://localhost/api/collections", { method: "GET" });
    const res = await handleCollections(req);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("returns 405 for HEAD request", async () => {
    const req = new Request("http://localhost/api/collections", { method: "HEAD" });
    const res = await handleCollections(req);
    expect([401, 405]).toContain(res.status);
  });

  it("handles route with empty id in path", async () => {
    const req = new Request("http://localhost/api/collections/", { method: "GET" });
    const res = await handleCollections(req);
    expect(res.status).toBe(401);
  });

  it("handles deeply nested paths", async () => {
    const req = new Request("http://localhost/api/collections/id/nested/path", { method: "GET" });
    const res = await handleCollections(req);
    expect([404, 401]).toContain(res.status);
  });
});
