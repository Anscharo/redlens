/**
 * The `git` CLI backend for atlas-git-source.ts: a local clone read with
 * `git ls-tree` and one `git cat-file --batch` per snapshot. The build scripts
 * and the atlas worker use it; anything without a git binary supplies its own
 * GitTreeBackend instead.
 */

import { execSync, spawnSync } from "node:child_process";

import type { GitBlob, GitBlobText, GitTreeBackend, GitTreeEntry } from "./atlas-git-source.ts";

/** Run `git <args>` in `repoDir` → trimmed stdout. Throws on a non-zero exit. */
export function makeGit(repoDir: string) {
  return (args: string, opts: Record<string, unknown> = {}): string =>
    execSync(`git ${args}`, { cwd: repoDir, encoding: "utf8", maxBuffer: 100 * 1024 * 1024, ...opts }).trim();
}

function run(repoDir: string, args: string[], input?: string): Buffer {
  const res = spawnSync("git", args, { cwd: repoDir, input, maxBuffer: 500 * 1024 * 1024 });
  if (res.status !== 0) throw new Error(`git ${args[0]} failed: ${res.stderr?.toString() ?? ""}`);
  return res.stdout;
}

/** `git ls-tree -z [-r] <treeish> -- <dir>/`. NUL-separated, so a path is never
 *  quoted, whatever characters it holds. A missing directory lists nothing. */
function listTree(repoDir: string, treeish: string, dir: string, recursive = false): GitTreeEntry[] {
  const args = ["ls-tree", "-z", ...(recursive ? ["-r"] : []), treeish, "--", `${dir}/`];
  const entries: GitTreeEntry[] = [];
  for (const rec of run(repoDir, args).toString("utf8").split("\0")) {
    const tab = rec.indexOf("\t");
    if (tab < 0) continue;
    // <mode> <type> <sha>\t<path>
    const [, type, sha] = rec.slice(0, tab).split(" ");
    entries.push({ type, sha, path: rec.slice(tab + 1) });
  }
  return entries;
}

/** Split `git cat-file --batch` output back into one text per requested blob. */
function splitBatch(buf: Buffer, blobs: GitBlob[]): GitBlobText[] {
  const out: GitBlobText[] = [];
  let pos = 0;
  for (const blob of blobs) {
    // Header line: "<sha> <type> <size>\n"
    const nl = buf.indexOf(0x0a, pos);
    if (nl < 0) throw new Error(`malformed cat-file output for ${blob.path}`);
    const header = buf.subarray(pos, nl).toString("utf8");
    const [sha, type, size] = header.split(" ");
    if (sha !== blob.sha || type !== "blob") throw new Error(`cat-file header mismatch for ${blob.path}: got ${header}`);
    const start = nl + 1;
    out.push({ ...blob, raw: buf.subarray(start, start + Number(size)).toString("utf8") });
    pos = start + Number(size) + 1; // past the \n after each blob
  }
  return out;
}

function readBlobs(repoDir: string, blobs: GitBlob[]): GitBlobText[] {
  if (!blobs.length) return [];
  const input = blobs.map((b) => b.sha).join("\n") + "\n";
  return splitBatch(run(repoDir, ["cat-file", "--batch"], input), blobs);
}

export function gitCliBackend(repoDir: string): GitTreeBackend {
  return {
    listTree: async (treeish, dir, recursive) => listTree(repoDir, treeish, dir, recursive),
    readBlobs: async (blobs) => readBlobs(repoDir, blobs),
  };
}
