// Integration: a private repo's commits fetch with the GitHub App's
// installation token, the way a private preview's commit history does.
//
// Opt-in, because it needs credentials and the network. Set GITHUB_APP_ID,
// GITHUB_APP_PRIVATE_KEY and PREVIEW_IT_PRIVATE_REPO (owner/name of a private
// atlas mirror the App is installed on, with at least three commits), then
// `bun test src/server/preview/commit-git.private.test.ts`. Skips otherwise.

import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { makeAtlasTreeReader } from "../../../scripts/lib/atlas-git-source.ts";
import { commitParents, fetchCommits, isoBackend } from "./commit-git.ts";
import { installationToken } from "./github-app.ts";
import { makeGhClient } from "./resolve.ts";

const REPO = process.env.PREVIEW_IT_PRIVATE_REPO ?? "";
const ENABLED = !!(REPO && process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY);

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), "pv-commit-it-"));

describe.skipIf(!ENABLED)(`private commit fetch (${REPO || "unset"})`, () => {
  test("fetches a sha that is no branch tip, and reads two commits", async () => {
    const token = await installationToken(REPO);
    expect(token).toBeTruthy();
    const r = await makeGhClient(token!).fetchJson(`/repos/${REPO}/commits?per_page=3`);
    expect(r.ok).toBe(true);
    const sha: string = r.json[2].sha;
    const gitdir = scratch();
    try {
      await fetchCommits({ repo: REPO, sha, depth: 2, token, gitdir });
      const [parent] = await commitParents(gitdir, sha);
      const reader = makeAtlasTreeReader(isoBackend(gitdir));
      expect((await reader.loadSnapshot(sha)).size).toBeGreaterThan(0);
      expect((await reader.loadSnapshot(parent)).size).toBeGreaterThan(0);
    } finally {
      fs.rmSync(gitdir, { recursive: true, force: true });
    }
  }, 120_000);

  test("an anonymous fetch is refused, and a failing fetch never echoes the token", async () => {
    const token = (await installationToken(REPO))!;
    const anon = scratch();
    const wrong = scratch();
    try {
      await expect(fetchCommits({ repo: REPO, sha: "0".repeat(40), depth: 1, gitdir: anon })).rejects.toThrow();
      const err = await fetchCommits({ repo: `${REPO}-missing`, sha: "0".repeat(40), depth: 1, token, gitdir: wrong }).catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect(`${err.message} ${JSON.stringify(err.data ?? {})}`).not.toContain(token);
    } finally {
      fs.rmSync(anon, { recursive: true, force: true });
      fs.rmSync(wrong, { recursive: true, force: true });
    }
  }, 60_000);
});
