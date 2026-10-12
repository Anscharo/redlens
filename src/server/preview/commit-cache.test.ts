// A kept commit-history walk is served only for the merge base it was made
// from, even once it is held in memory. Run via `bun test`.

import { afterAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { previewPaths } from "./cache.ts";
import { cachedCommitEvents, writeCommitCache, type CommitHistoryFile } from "./commit-cache.ts";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "redlens-commit-cache-"));
const SHA = "c".repeat(40);
afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

const FILE: CommitHistoryFile = { version: 1, base: "repo", mergeBase: "mb1", head: SHA, total: 0, truncated: false, commits: [] };

describe("cachedCommitEvents", () => {
  test("replays a walk for its own merge base, and never for another", () => {
    fs.mkdirSync(previewPaths(SHA, ROOT).outDir, { recursive: true });
    writeCommitCache(SHA, FILE, ROOT);
    expect(cachedCommitEvents(SHA, "repo", "mb1", ROOT)?.map((e) => e.type)).toEqual(["range", "done"]);
    expect(cachedCommitEvents(SHA, "repo", "mb2", ROOT)).toBeNull();
    expect(cachedCommitEvents(SHA, "sky", "mb1", ROOT)).toBeNull();
  });
});
