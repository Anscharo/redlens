// The commits a preview's branch added on top of its diff base, from GitHub's
// compare API. Compare answers exactly "reachable from the head, not from the
// merge base", which a shallow clone cannot: there, a commit near the fetch
// boundary has lost the ancestry that would say which side it belongs to.

import type { GhClient } from "./resolve.ts";

export interface CommitMeta {
  sha: string;
  parents: string[];
  /** Author date, ISO 8601: when the change was written, as live history dates it. */
  date: string;
  /** GitHub login when the author has one, else the git author name. */
  author: string | null;
  /** First line of the commit message. */
  message: string;
}

export interface CommitRange {
  /** Every commit in the range, of which `commits` is the newest `cap`. */
  total: number;
  /** Newest first. */
  commits: CommitMeta[];
}

/** Compare's page size ceiling. */
const PAGE = 100;

function toMeta(c: any): CommitMeta {
  return {
    sha: c.sha,
    parents: (c.parents ?? []).map((p: { sha: string }) => p.sha),
    date: c.commit?.author?.date ?? "",
    author: c.author?.login ?? c.commit?.author?.name ?? null,
    message: String(c.commit?.message ?? "").split("\n")[0],
  };
}

async function page(gh: GhClient, repo: string, mergeBase: string, head: string, n: number): Promise<any | null> {
  const r = await gh.fetchJson(`/repos/${repo}/compare/${encodeURIComponent(mergeBase)}...${encodeURIComponent(head)}?per_page=${PAGE}&page=${n}`);
  return r.ok ? r.json : null;
}

/** The newest `cap` commits of `mergeBase...head` in `repo`, or null when
 *  compare fails. Pages are oldest first, so the newest commits are read from
 *  the last page and, when it is short, the one before it. */
export async function commitRange(gh: GhClient, repo: string, mergeBase: string, head: string, cap: number): Promise<CommitRange | null> {
  const first = await page(gh, repo, mergeBase, head, 1);
  if (!first) return null;
  const total: number = first.total_commits ?? first.commits?.length ?? 0;
  let raw: any[] = first.commits ?? [];
  if (total > PAGE) {
    const last = Math.ceil(total / PAGE);
    const from = Math.max(1, Math.floor((total - Math.min(cap, total)) / PAGE) + 1);
    raw = [];
    for (let n = from; n <= last; n++) {
      const p = n === 1 ? first : await page(gh, repo, mergeBase, head, n);
      if (!p) return null;
      raw.push(...(p.commits ?? []));
    }
  }
  return { total, commits: raw.map(toMeta).reverse().slice(0, cap) };
}
