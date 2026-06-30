import { describe, it, expect } from "vitest";
import { parsePreviewInput, previewLabel } from "./previewLocal";

describe("parsePreviewInput", () => {
  it("parses GitHub URLs (PR / tree / commit, canonical + fork)", () => {
    expect(parsePreviewInput("https://github.com/sky-ecosystem/next-gen-atlas/pull/256")).toBe("pull-256");
    expect(parsePreviewInput("https://github.com/sky-ecosystem/next-gen-atlas/pull/256/files")).toBe("pull-256");
    expect(parsePreviewInput("https://github.com/sky-ecosystem/next-gen-atlas/tree/my-branch")).toBe("my-branch");
    expect(parsePreviewInput("https://github.com/blimpa/next-gen-atlas/tree/spark")).toBe("blimpa:spark");
    // `/` in branch names → `~`
    expect(parsePreviewInput("https://github.com/blimpa/next-gen-atlas/tree/feat/parser-fix")).toBe(
      "blimpa:feat~parser-fix",
    );
    const sha = "a".repeat(40);
    expect(parsePreviewInput(`https://github.com/blimpa/next-gen-atlas/commit/${sha}`)).toBe(sha);
    // bare repo URL has nothing to preview
    expect(parsePreviewInput("https://github.com/blimpa/next-gen-atlas")).toBeNull();
    // a fork's /pull/N is a PR against the FORK (PR numbers are repo-local)
    expect(parsePreviewInput("https://github.com/blimpa/other-repo/pull/1")).toBeNull();
    expect(parsePreviewInput("https://github.com/blimpa/next-gen-atlas/pull/1")).toBeNull();
  });

  it("parses renamed-fork URLs and ids (repo name carried in the id)", () => {
    expect(parsePreviewInput("https://github.com/blimpa/my-atlas/tree/spark")).toBe("blimpa:my-atlas:spark");
    expect(parsePreviewInput("https://github.com/blimpa/my-atlas/tree/feat/x")).toBe("blimpa:my-atlas:feat~x");
    // canonical-owner lookalike repo is still not THE atlas
    expect(parsePreviewInput("https://github.com/sky-ecosystem/other/tree/main")).toBe("sky-ecosystem:other:main");
    expect(parsePreviewInput("blimpa:my-atlas:feat/x")).toBe("blimpa:my-atlas:feat~x");
  });

  it("passes through bare ids and normalizes", () => {
    expect(parsePreviewInput("pull-256")).toBe("pull-256");
    expect(parsePreviewInput("256")).toBe("pull-256");
    expect(parsePreviewInput("#256")).toBe("pull-256");
    expect(parsePreviewInput("A".repeat(40))).toBe("a".repeat(40));
    expect(parsePreviewInput("blimpa:feat/x")).toBe("blimpa:feat~x");
    expect(parsePreviewInput("my-branch")).toBe("my-branch");
    expect(parsePreviewInput("feat/x")).toBe("feat~x");
    expect(parsePreviewInput("")).toBeNull();
    expect(parsePreviewInput("   ")).toBeNull();
  });
});

describe("previewLabel", () => {
  it("uses the PR number for pull ids", () => {
    expect(previewLabel("pull-256")).toBe("PR #256");
    expect(previewLabel("  pull-1 ")).toBe("PR #1");
  });

  it("shortens a pinned sha", () => {
    expect(previewLabel("a".repeat(40))).toBe("aaaaaaa");
    expect(previewLabel("A".repeat(40))).toBe("AAAAAAA"); // not normalized — display only
  });

  it("uses owner/repo for fork ids", () => {
    expect(previewLabel("blimpa:my-atlas:spark")).toBe("blimpa/my-atlas");
    expect(previewLabel("blimpa:spark")).toBe("blimpa/next-gen-atlas"); // repo defaults to the atlas
  });

  it("falls back to the canonical repo for a bare branch", () => {
    expect(previewLabel("my-branch")).toBe("sky-ecosystem/next-gen-atlas");
    expect(previewLabel("feat~parser-fix")).toBe("sky-ecosystem/next-gen-atlas");
  });
});
