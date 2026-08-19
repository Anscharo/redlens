// Bun coverage of scripts/lib/atlas-commit.mjs is what the area meter sees
// (indexes.ts imports pickAtlasCommit, so bun's hit count used to outrank
// vitest and leave gitHead / stampAtlasCommit as DA:0). Exercise every export
// here so the runner that loads the module actually runs it.
import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  UNKNOWN_ATLAS_COMMIT,
  gitHead,
  isUsableAtlasCommit,
  pickAtlasCommit,
  stampAtlasCommit,
} from "../../../scripts/lib/atlas-commit.mjs";

describe("atlas-commit (bun)", () => {
  it("isUsableAtlasCommit rejects empty, unknown, and non-strings", () => {
    expect(isUsableAtlasCommit("")).toBe(false);
    expect(isUsableAtlasCommit(UNKNOWN_ATLAS_COMMIT)).toBe(false);
    expect(isUsableAtlasCommit(null)).toBe(false);
    expect(isUsableAtlasCommit("06e2b9b469c829a8763155c63c6f4541e285f473")).toBe(true);
  });

  it("stampAtlasCommit prefers the first usable sha and falls back to unknown", () => {
    expect(stampAtlasCommit("env-sha", "docs-sha")).toBe("env-sha");
    expect(stampAtlasCommit(UNKNOWN_ATLAS_COMMIT, "docs-sha")).toBe("docs-sha");
    expect(stampAtlasCommit(UNKNOWN_ATLAS_COMMIT, null)).toBe(UNKNOWN_ATLAS_COMMIT);
    expect(pickAtlasCommit(UNKNOWN_ATLAS_COMMIT, "")).toBeNull();
  });

  it("gitHead returns a 40-hex sha for this repo and null outside a repo", () => {
    expect(gitHead(process.cwd())).toMatch(/^[0-9a-f]{40}$/);
    const empty = mkdtempSync(join(tmpdir(), "atlas-commit-"));
    expect(gitHead(empty)).toBeNull();
  });
});
