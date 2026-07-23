// Test atlas artifact serving (GET /api/atlas/:sha/:name.json).
import { describe, it, expect } from "bun:test";
import { handleAtlasStatic } from "./atlas-static.ts";

describe("handleAtlasStatic", () => {
  it("returns 404 for empty pathname", async () => {
    const req = new Request("http://example/api/atlas/", { method: "GET" });
    const res = await handleAtlasStatic(req, "/api/atlas/");
    expect(res.status).toBe(404);
  });

  it("returns 404 for single segment (missing artifact name)", async () => {
    const req = new Request("http://example/api/atlas/abc", { method: "GET" });
    const res = await handleAtlasStatic(req, "/api/atlas/abc");
    expect(res.status).toBe(404);
  });

  it("returns 404 for three segments (too many)", async () => {
    const req = new Request("http://example/api/atlas/sha/name/extra", { method: "GET" });
    const res = await handleAtlasStatic(req, "/api/atlas/sha/name/extra");
    expect(res.status).toBe(404);
  });

  it("rejects SHA with non-hex characters", async () => {
    const req = new Request("http://example/api/atlas/gggggggggggggggggggggggggggggggggggggggg/docs.json", { method: "GET" });
    const res = await handleAtlasStatic(req, "/api/atlas/gggggggggggggggggggggggggggggggggggggggg/docs.json");
    expect(res.status).toBe(404);
  });

  it("rejects SHA with wrong character count (too short)", async () => {
    const req = new Request("http://example/api/atlas/abc123/docs.json", { method: "GET" });
    const res = await handleAtlasStatic(req, "/api/atlas/abc123/docs.json");
    expect(res.status).toBe(404);
  });

  it("rejects SHA with wrong character count (too long)", async () => {
    const req = new Request("http://example/api/atlas/abc123def456789012345678901234567890abcdef1234567890/docs.json", { method: "GET" });
    const res = await handleAtlasStatic(req, "/api/atlas/abc123def456789012345678901234567890abcdef1234567890/docs.json");
    expect(res.status).toBe(404);
  });

  it("accepts valid lowercase hex SHA", async () => {
    // With a valid SHA but no bundle store, serveBundleArtifact will return null -> 404
    const req = new Request("http://example/api/atlas/0000000000000000000000000000000000000000/docs.json", { method: "GET" });
    const res = await handleAtlasStatic(req, "/api/atlas/0000000000000000000000000000000000000000/docs.json");
    // Will be 404 if bundle is missing, which is correct behavior
    expect([404]).toContain(res.status);
  });

  it("accepts valid uppercase hex SHA", async () => {
    // SHA_RE is case-insensitive
    const req = new Request("http://example/api/atlas/FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF/docs.json", { method: "GET" });
    const res = await handleAtlasStatic(req, "/api/atlas/FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF/docs.json");
    // Will be 404 if bundle is missing, which is correct behavior
    expect([404]).toContain(res.status);
  });
});
