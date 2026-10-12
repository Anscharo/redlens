// In-process git for a preview's commit history: the web image carries no git
// binary, so commits are fetched and read with isomorphic-git into a scratch
// bare repo. Layout knowledge stays in atlas-git-source.ts; this module only
// supplies its GitTreeBackend.
//
// Credentials travel only as an Authorization header, never in the remote URL:
// isomorphic-git puts the URL in its error messages, and those reach logs.

import fs from "node:fs";
import git from "isomorphic-git";
import http from "isomorphic-git/http/node";

import type { GitTreeBackend, GitTreeEntry } from "../../../scripts/lib/atlas-git-source.ts";

export interface FetchProgress {
  phase: string;
  loaded: number;
  total?: number;
}

export interface FetchOpts {
  /** owner/name on github.com. */
  repo: string;
  sha: string;
  /** Commits to fetch counting the head: everything this deep is readable. */
  depth: number;
  /** An installation token for a private repo; public repos fetch anonymously. */
  token?: string | null;
  gitdir: string;
  onProgress?: (p: FetchProgress) => void;
}

const basicAuth = (token: string) => `Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;

/** Shallow-fetch `sha` and its ancestors `depth` deep into a new bare repo.
 *  GitHub serves any sha a ref reaches, so a head that is no branch tip fetches
 *  too; one no ref reaches (force-pushed away) does not. */
export async function fetchCommits(o: FetchOpts): Promise<void> {
  fs.mkdirSync(o.gitdir, { recursive: true });
  await git.init({ fs, gitdir: o.gitdir, bare: true });
  await git.addRemote({ fs, gitdir: o.gitdir, remote: "origin", url: `https://github.com/${o.repo}` });
  // fetch refuses a remote without a refspec, even when it names the ref itself.
  await git.setConfig({ fs, gitdir: o.gitdir, path: "remote.origin.fetch", value: "+refs/*:refs/remotes/origin/*" });
  await git.fetch({
    fs,
    http,
    gitdir: o.gitdir,
    remote: "origin",
    ref: o.sha,
    remoteRef: o.sha,
    singleBranch: true,
    tags: false,
    depth: o.depth,
    headers: o.token ? { Authorization: basicAuth(o.token) } : {},
    onProgress: o.onProgress ? (p) => o.onProgress!({ phase: p.phase, loaded: p.loaded, total: p.total }) : undefined,
  });
}

type TreeItem = { path: string; oid: string; type: string };

async function readDir(gitdir: string, cache: object, treeish: string, dir: string): Promise<TreeItem[] | null> {
  try {
    return (await git.readTree({ fs, gitdir, oid: treeish, filepath: dir, cache })).tree;
  } catch (e) {
    if ((e as { code?: string }).code === "NotFoundError") return null;
    throw e;
  }
}

/** Tree entries as backend entries, in git's own order (`git ls-tree`'s order),
 *  descending into subtrees when `recursive`. */
async function collect(gitdir: string, cache: object, items: TreeItem[], dir: string, recursive: boolean, out: GitTreeEntry[]): Promise<void> {
  for (const e of items) {
    const p = `${dir}/${e.path}`;
    if (!recursive || e.type !== "tree") out.push({ type: e.type, sha: e.oid, path: p });
    else await collect(gitdir, cache, (await git.readTree({ fs, gitdir, oid: e.oid, cache })).tree, p, true, out);
  }
}

/** GitTreeBackend over a bare repo. Objects are cached across calls, so a walk
 *  that reads neighbouring commits inflates each unchanged blob once. */
export function isoBackend(gitdir: string): GitTreeBackend {
  const cache = {};
  const dec = new TextDecoder();
  return {
    async listTree(treeish, dir, recursive = false) {
      const out: GitTreeEntry[] = [];
      await collect(gitdir, cache, (await readDir(gitdir, cache, treeish, dir)) ?? [], dir, recursive, out);
      return out;
    },
    async readBlobs(blobs) {
      const out = [];
      for (const b of blobs) out.push({ ...b, raw: dec.decode((await git.readBlob({ fs, gitdir, oid: b.sha, cache })).blob) });
      return out;
    },
  };
}

/** The parents of a fetched commit. */
export async function commitParents(gitdir: string, sha: string): Promise<string[]> {
  return (await git.readCommit({ fs, gitdir, oid: sha })).commit.parent;
}
