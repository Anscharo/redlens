// Walk a branch's commits newest first and describe each one. Newest first so
// the rows a reader most likely wants arrive first; each commit costs one new
// snapshot parse, because its parent is usually the next commit walked.

import type { GitSnapshot } from "../../../scripts/lib/atlas-git-parse.ts";
import { commitEntries, mergeEntries, type CommitEntries } from "./commit-events.ts";
import type { CommitMeta } from "./commit-range.ts";

export interface CommitRecord extends CommitMeta {
  merge: boolean;
  entries: CommitEntries;
}

export interface WalkOpts {
  loadSnapshot: (sha: string) => Promise<GitSnapshot>;
  /** Called per commit, in walk order; `index` 0 is the newest. */
  emit: (rec: CommitRecord, index: number) => void;
  /** Checked between commits; true stops the walk. */
  stopped?: () => boolean;
}

/** Snapshots the walk still needs: the current commit's and its parents'. */
const KEEP = 4;

function snapshotCache(load: (sha: string) => Promise<GitSnapshot>) {
  const held = new Map<string, Promise<GitSnapshot>>();
  return (sha: string): Promise<GitSnapshot> => {
    let p = held.get(sha);
    if (!p) {
      p = load(sha);
      held.set(sha, p);
      if (held.size > KEEP) held.delete(held.keys().next().value!);
    }
    return p;
  };
}

/** Describe each commit; resolves to whether the walk ended before the list
 *  did (stopped, or a parent outside the fetched history). */
export async function walkCommits(commits: CommitMeta[], o: WalkOpts): Promise<{ truncated: boolean }> {
  const snap = snapshotCache(o.loadSnapshot);
  for (let i = 0; i < commits.length; i++) {
    if (o.stopped?.()) return { truncated: true };
    const c = commits[i];
    let parents: GitSnapshot[];
    try {
      parents = await Promise.all(c.parents.map(snap));
    } catch {
      return { truncated: true };
    }
    const curr = await snap(c.sha);
    const merge = parents.length > 1;
    const entries = merge ? mergeEntries(parents, curr) : commitEntries(parents[0] ?? new Map(), curr);
    o.emit({ ...c, merge, entries }, i);
  }
  return { truncated: false };
}
