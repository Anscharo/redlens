// isomorphic-git as a GitTreeBackend: it must load exactly the snapshots the git
// CLI does, on the real atlas, in whatever layout its commits are. Reads the
// submodule's own object store, so it needs the atlas history but no network;
// it skips without the submodule. Run via `bun test`.

import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { makeAtlasGitSource, makeAtlasTreeReader } from "../../../scripts/lib/atlas-git-source.ts";
import { commitParents, isoBackend } from "./commit-git.ts";

const ATLAS = path.resolve(import.meta.dir, "../../../vendor/next-gen-atlas");

function atlasGitdir(): string | null {
  if (!fs.existsSync(path.join(ATLAS, "content")) && !fs.existsSync(path.join(ATLAS, "Sky Atlas"))) return null;
  try {
    return execFileSync("git", ["-C", ATLAS, "rev-parse", "--absolute-git-dir"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

const GITDIR = atlasGitdir();

describe.skipIf(!GITDIR)("isoBackend on the checked-out atlas", () => {
  test("loads the same snapshots as the git CLI for the newest atlas commits", async () => {
    const cli = makeAtlasGitSource(ATLAS);
    const iso = makeAtlasTreeReader(isoBackend(GITDIR!));
    const commits = cli.atlasCommits().slice(-4);
    expect(commits.length).toBeGreaterThan(0);
    for (const { hash } of commits) {
      expect(await iso.detectFormat(hash)).toBe(await cli.detectFormat(hash));
      expect([...(await iso.loadSnapshot(hash))]).toEqual([...(await cli.loadSnapshot(hash))]);
    }
  }, 60_000);

  test("reports a commit's parents", async () => {
    const cli = makeAtlasGitSource(ATLAS);
    const head = cli.git("rev-parse HEAD");
    expect(await commitParents(GITDIR!, head)).toEqual(cli.git(`rev-parse ${head}^@`).split("\n"));
  });

  test("a directory a commit lacks lists as empty, not as an error", async () => {
    const head = makeAtlasGitSource(ATLAS).git("rev-parse HEAD");
    expect(await isoBackend(GITDIR!).listTree(head, "no-such-dir")).toEqual([]);
  });
});
