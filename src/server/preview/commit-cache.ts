// A finished commit-history walk, kept in the preview bundle as
// commits-<base>.json. A bundle is immutable per head sha and a diff base's
// merge base is fixed in its meta.json, so the file never goes stale; it goes
// when the bundle is evicted. It is written last and renamed into place, so a
// file that exists is a whole walk.

import fs from "node:fs";
import path from "node:path";

import { previewPaths } from "./cache.ts";
import type { BaseKey } from "./cache.ts";
import type { CommitStreamEvent } from "./commit-stream.ts";
import type { CommitRecord } from "./commit-walk.ts";

export interface CommitHistoryFile {
  version: 1;
  base: BaseKey;
  mergeBase: string;
  head: string;
  /** Commits on the branch since its base; `commits` holds the newest of them. */
  total: number;
  /** Fewer commits are described than `total` counts. */
  truncated: boolean;
  /** Newest first. */
  commits: CommitRecord[];
}

/** Parsed files held in memory: one walk is read once per document a reader opens. */
const HELD = 4;
const held = new Map<string, CommitHistoryFile>();

export function commitCachePath(sha: string, base: BaseKey, root?: string): string {
  return path.join(previewPaths(sha, root).outDir, `commits-${base}.json`);
}

export function writeCommitCache(sha: string, file: CommitHistoryFile, root?: string): void {
  const dest = commitCachePath(sha, file.base, root);
  const tmp = `${dest}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(file));
  fs.renameSync(tmp, dest);
}

function readFile(p: string): CommitHistoryFile | null {
  const hit = held.get(p);
  if (hit) return hit;
  let f: CommitHistoryFile;
  try {
    f = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
  held.set(p, f);
  if (held.size > HELD) held.delete(held.keys().next().value!);
  return f;
}

/** The finished walk as the event sequence a live walk sends, or null. */
export function cachedCommitEvents(sha: string, base: BaseKey, root?: string): CommitStreamEvent[] | null {
  const f = readFile(commitCachePath(sha, base, root));
  if (!f) return null;
  return [
    { type: "range", total: f.total, walking: f.commits.length },
    ...f.commits.map((commit, index): CommitStreamEvent => ({ type: "commit", index, commit })),
    { type: "done", truncated: f.truncated },
  ];
}
