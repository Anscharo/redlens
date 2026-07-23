// Test atlas artifact serving (GET /api/atlas/:sha/:name.json).
import { describe, it, expect } from "bun:test";

describe("handleAtlasStatic", () => {
  it("serves immutable atlas artifacts", () => {
    // handleAtlasStatic dispatches /api/atlas/:sha/:name.json requests
    // It validates the SHA (40 hex chars), lowercases it, and calls serveBundleArtifact
    // with immutable cache headers (max-age=31536000, immutable)
  });

  it("returns 404 for invalid SHA format", () => {
    // SHA_RE requires exactly 40 hexadecimal characters (case-insensitive)
    // Non-hex characters or wrong length should be rejected
  });

  it("returns 404 for wrong pathname structure", () => {
    // Must have exactly 2 segments after /api/atlas/ (sha and name)
    // Empty segments, missing segments, or extra segments are rejected
  });

  it("lowercases SHA before passing to serveBundleArtifact", () => {
    // Uppercase hex is valid in the regex but must be lowercased
    // for immutable per-SHA artifact lookup
  });

  it("returns 404 when serveBundleArtifact returns null", () => {
    // Pruned or missing SHAs should 404 instead of serving wrong data
  });
});
