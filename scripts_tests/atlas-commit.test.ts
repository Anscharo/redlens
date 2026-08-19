import { describe, expect, it } from "vitest";
import {
  UNKNOWN_ATLAS_COMMIT,
  gitHead,
  isUsableAtlasCommit,
  pickAtlasCommit,
  stampAtlasCommit,
} from "../scripts/lib/atlas-commit.mjs";

describe("isUsableAtlasCommit", () => {
  it("rejects empty, unknown, and non-strings", () => {
    expect(isUsableAtlasCommit("")).toBe(false);
    expect(isUsableAtlasCommit(UNKNOWN_ATLAS_COMMIT)).toBe(false);
    expect(isUsableAtlasCommit(null)).toBe(false);
    expect(isUsableAtlasCommit(undefined)).toBe(false);
    expect(isUsableAtlasCommit("06e2b9b469c829a8763155c63c6f4541e285f473")).toBe(true);
  });
});

describe("pickAtlasCommit / stampAtlasCommit", () => {
  it("prefers env, then docs.json, then git, skipping unknown", () => {
    expect(pickAtlasCommit("env-sha", "docs-sha", "git-sha")).toBe("env-sha");
    expect(pickAtlasCommit(UNKNOWN_ATLAS_COMMIT, "docs-sha", "git-sha")).toBe("docs-sha");
    expect(pickAtlasCommit(undefined, UNKNOWN_ATLAS_COMMIT, "git-sha")).toBe("git-sha");
    expect(pickAtlasCommit(UNKNOWN_ATLAS_COMMIT, UNKNOWN_ATLAS_COMMIT, null)).toBeNull();
    expect(stampAtlasCommit(UNKNOWN_ATLAS_COMMIT, null)).toBe(UNKNOWN_ATLAS_COMMIT);
  });
});

describe("gitHead", () => {
  it("returns a 40-hex sha for this repo", () => {
    expect(gitHead(process.cwd())).toMatch(/^[0-9a-f]{40}$/);
  });

  it("returns null for a non-repo path", () => {
    expect(gitHead("/tmp")).toBeNull();
  });
});
