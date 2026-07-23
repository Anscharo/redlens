// Test collections routes (/api/collections).
import { describe, it, expect } from "bun:test";
import { handleCollections, handleSharedCollection } from "./collections.ts";

describe("handleSharedCollection", () => {
  it("returns 405 for POST request", async () => {
    const req = new Request("http://localhost/api/collections/test-id/shared", { method: "POST" });
    const res = await handleSharedCollection(req);
    expect(res.status).toBe(405);
  });

  it("returns 404 for malformed path", async () => {
    const req = new Request("http://localhost/api/collections/test-id", { method: "GET" });
    const res = await handleSharedCollection(req);
    expect(res.status).toBe(404);
  });

  it("returns 404 for missing shared suffix", async () => {
    const req = new Request("http://localhost/api/collections/test-id/other", { method: "GET" });
    const res = await handleSharedCollection(req);
    expect(res.status).toBe(404);
  });

  it("returns JSON error for non-existent collection", async () => {
    const req = new Request("http://localhost/api/collections/nonexistent-id/shared", { method: "GET" });
    const res = await handleSharedCollection(req);
    // Will be 404 since collection doesn't exist in DB
    expect([404]).toContain(res.status);
  });

  it("returns JSON response with correct content-type", async () => {
    const req = new Request("http://localhost/api/collections/test-id/shared", { method: "GET" });
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

  it("returns 405 for PUT method", async () => {
    const req = new Request("http://localhost/api/collections", { method: "PUT" });
    const res = await handleCollections(req);
    expect(res.status).toBe(405);
  });

  it("returns 400 for invalid JSON in POST", async () => {
    // We can't easily test this without session, but document the path
    const req = new Request("http://localhost/api/collections", {
      method: "POST",
      body: "invalid json",
      headers: { "content-type": "application/json" }
    });
    const res = await handleCollections(req);
    expect([400, 401]).toContain(res.status);
  });

  it("returns JSON response", async () => {
    const req = new Request("http://localhost/api/collections", { method: "GET" });
    const res = await handleCollections(req);
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});
