// Network I/O for `pnpm votes:sync`: a vote repository's main-branch tarball,
// or a local checkout in its place, and the JSON fetcher the portal reader uses.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { FetchJson } from "./portal.ts";

const execFileAsync = promisify(execFile);
// Unattended callers must not hang on a connection that accepts and then stalls.
const FETCH_TIMEOUT_MS = 60_000;

export interface Tree {
  root: string;
  source: string;
  cleanup: () => void;
}

export async function repoTree(repo: string, dir: string | undefined): Promise<Tree> {
  if (dir) return { root: path.resolve(dir), source: path.resolve(dir), cleanup: () => {} };
  const url = `https://github.com/sky-ecosystem/${repo}/archive/refs/heads/main.tar.gz`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `${repo}-`));
  const cleanup = () => fs.rmSync(tmp, { recursive: true, force: true });
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`fetch ${url}: ${res.status} ${res.statusText}`);
    const tgz = path.join(tmp, "src.tgz");
    fs.writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
    await execFileAsync("tar", ["-xzf", tgz, "-C", tmp]);
    const top = fs.readdirSync(tmp, { withFileTypes: true }).find((e) => e.isDirectory());
    if (!top) throw new Error(`tarball from ${url} held no directory`);
    return { root: path.join(tmp, top.name), source: url, cleanup };
  } catch (err) {
    cleanup();
    throw err;
  }
}

export const fetchJson: FetchJson = async (url) => {
  const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status} ${res.statusText}`);
  return res.json();
};
