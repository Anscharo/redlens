// Polls in the vote record as matching sees them: which passed, where each
// lives, and the poll that approved each next-gen-atlas pull request with the
// executives citing it. Pure.

import type { IndexedExecutive } from "./vote-index";
import type { Executive, Poll } from "./types";

const POLLS_REPO = "https://github.com/sky-ecosystem/polls/blob/main/";

/** A passed poll as a link target. */
export interface PollRef {
  title: string;
  date: string;
  url: string;
}

/** A poll that approved an atlas pull request, with the executives whose authorization cites it, oldest first. */
export interface ApprovingPoll extends PollRef {
  citedBy: Array<Pick<IndexedExecutive, "title" | "date" | "url">>;
}

/** Whether a poll's winning option carried it: a poll that rejected its proposal authorises nothing. */
export function pollPassed(p: Poll): boolean {
  const w = p.portal?.winner;
  return !!w && !/^(no|against|reject)/i.test(w);
}

export function pollUrl(p: Poll): string {
  return p.portal ? `https://vote.sky.money/polling/${p.portal.slug}` : POLLS_REPO + p.file;
}

/** The earliest passed poll linking each pull request; `indexed[i]` is `executives[i]` indexed. */
export function buildApprovals(polls: readonly Poll[], executives: readonly Executive[], indexed: readonly IndexedExecutive[]): Map<number, ApprovingPoll> {
  const approvals = new Map<number, ApprovingPoll>();
  const citing = executivesCiting(executives, indexed);
  for (const p of polls.filter(pollPassed)) {
    // An artifact written before polls recorded their pull requests has no atlasPrs.
    for (const pr of p.atlasPrs ?? []) {
      const seen = approvals.get(pr);
      if (!seen || p.date < seen.date) approvals.set(pr, { title: p.title, date: p.date, url: pollUrl(p), citedBy: citing(p) });
    }
  }
  return approvals;
}

/**
 * The executives whose sections link a poll (by portal slug or poll id), for
 * any poll, oldest first. An executive citing a poll says only that the poll
 * authorised one of its actions, not which edit of the poll it carried out.
 */
function executivesCiting(executives: readonly Executive[], indexed: readonly IndexedExecutive[]): (p: Poll) => IndexedExecutive[] {
  const byKey = new Map<string, Set<IndexedExecutive>>();
  executives.forEach((e, i) => {
    for (const l of e.sections.flatMap((s) => [...s.authorization, ...s.proposal])) {
      if (l.family !== "poll") continue;
      for (const key of [l.pollSlug && `slug:${l.pollSlug}`, l.pollId != null && `id:${l.pollId}`]) {
        if (key) byKey.set(key, (byKey.get(key) ?? new Set()).add(indexed[i]));
      }
    }
  });
  return (p) => {
    if (!p.portal) return [];
    const found = new Set([...(byKey.get(`slug:${p.portal.slug}`) ?? []), ...(byKey.get(`id:${p.portal.pollId}`) ?? [])]);
    return [...found].sort((x, y) => x.date.localeCompare(y.date));
  };
}
