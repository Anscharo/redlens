// The vote record (public/votes.json) indexed for matching: executives by
// filename date with their searchable text, every vote by the atlas uuids it
// links, and the poll that approved each atlas pull request. Built once per
// load; pure.

import type { AtlasNode } from "../../types";
import { SubjectCorpus } from "./subject";
import type { Executive, Poll, VotesArtifact } from "./types";

/** A spell may slip this many days past the date the atlas names for it. */
export const SLIP_DAYS = 7;
/** A vote linking a claim's document counts when it falls this many days before or after the claim. */
export const LINK_WINDOW = { before: 45, after: 70 } as const;
/** How far up from the claim's document a linking vote may point, never reaching a Scope or Article. */
const MAX_LINK_ASCENT = 2;
const TOO_BROAD_TO_LINK = new Set(["Scope", "Article"]);

export interface IndexedExecutive {
  date: string;
  title: string;
  url: string;
  outOfSchedule: boolean;
  cast: boolean;
  /** The deployed spell's address; null while the executive is drafted. Deployed is not cast: see `cast`. */
  spell: string | null;
  /** Title, summary and every action section, lowercased. */
  text: string;
}

export type LinkedVote =
  | { kind: "executive"; date: string; executive: IndexedExecutive }
  | { kind: "poll"; date: string; title: string; url: string };

/** A passed poll as a link target. */
export interface PollRef {
  title: string;
  date: string;
  url: string;
}

export interface VoteIndex {
  executives: IndexedExecutive[];
  /** First and last executive filename dates: the span the record can speak for. */
  first: string;
  last: string;
  corpus: SubjectCorpus;
  links: Map<string, LinkedVote[]>;
  /** The earliest passed poll linking each next-gen-atlas pull request: the poll that approved that edit. */
  approvals: Map<number, ApprovingPoll>;
}

/** A poll that approved an atlas pull request, with the executives whose authorization cites it, oldest first. */
export interface ApprovingPoll extends PollRef {
  citedBy: Array<Pick<IndexedExecutive, "title" | "date" | "url">>;
}

const EXECUTIVES_REPO = "https://github.com/sky-ecosystem/executive-votes/blob/main/";
const POLLS_REPO = "https://github.com/sky-ecosystem/polls/blob/main/";

export function buildVoteIndex(a: VotesArtifact): VoteIndex {
  const indexed = a.executives.map(indexExecutive);
  const links = new Map<string, LinkedVote[]>();
  const add = (uuids: Array<string | undefined>, v: LinkedVote) => {
    for (const uuid of new Set(uuids)) if (uuid) links.set(uuid, [...(links.get(uuid) ?? []), v]);
  };
  a.executives.forEach((e, i) => {
    const uuids = e.sections.flatMap((s) => s.atlasRefs.map((l) => l.uuid));
    add(uuids, { kind: "executive", date: e.date, executive: indexed[i] });
  });
  const approvals = new Map<number, ApprovingPoll>();
  const citing = executivesCiting(a.executives, indexed);
  for (const p of a.polls.filter(pollPassed)) {
    add(p.atlasRefs.map((l) => l.uuid), { kind: "poll", date: p.date, title: p.title, url: pollUrl(p) });
    // An artifact written before polls recorded their pull requests has no atlasPrs.
    for (const pr of p.atlasPrs ?? []) {
      const seen = approvals.get(pr);
      if (!seen || p.date < seen.date) approvals.set(pr, { title: p.title, date: p.date, url: pollUrl(p), citedBy: citing(p) });
    }
  }
  const executives = [...indexed].sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
  return {
    executives,
    first: executives[0]?.date ?? "",
    last: executives.at(-1)?.date ?? "",
    corpus: new SubjectCorpus(executives.map((e) => e.text)),
    links,
    approvals,
  };
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

function indexExecutive(e: Executive): IndexedExecutive {
  const sections = e.sections.map((s) => `${s.heading.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")} ${s.text}`);
  return {
    date: e.date,
    title: e.title,
    url: e.portal ? `https://vote.sky.money/executive/${e.portal.key}` : EXECUTIVES_REPO + e.file,
    outOfSchedule: e.outOfSchedule,
    cast: e.portal?.hasBeenCast === true,
    spell: e.address,
    text: [e.title, e.summary, ...sections].join(" ").toLowerCase(),
  };
}

/** Whether a poll's winning option carried it: a poll that rejected its proposal authorises nothing. */
export function pollPassed(p: Poll): boolean {
  const w = p.portal?.winner;
  return !!w && !/^(no|against|reject)/i.test(w);
}

export function pollUrl(p: Poll): string {
  return p.portal ? `https://vote.sky.money/polling/${p.portal.slug}` : POLLS_REPO + p.file;
}

/**
 * The executive a claim dated `iso` names: the one filed on that exact date
 * (the out-of-schedule one when the claim says so), else the first filed
 * within SLIP_DAYS after it.
 */
export function executiveFor(index: VoteIndex, iso: string, outOfSchedule: boolean): IndexedExecutive | null {
  const latest = addDays(iso, SLIP_DAYS);
  const near = index.executives.filter((e) => e.date >= iso && e.date <= latest);
  const sameDay = near.filter((e) => e.date === iso);
  return sameDay.find((e) => e.outOfSchedule === outOfSchedule) ?? sameDay[0] ?? near[0] ?? null;
}

/** Votes linking `docId` or a near parent inside LINK_WINDOW, executives first, then nearest to the claim. */
export function linkedVotes(index: VoteIndex, docId: string, docs: Record<string, AtlasNode>, iso: string): LinkedVote[] {
  const hits: LinkedVote[] = [];
  let doc: AtlasNode | undefined = docs[docId];
  for (let up = 0; doc && up <= MAX_LINK_ASCENT && !TOO_BROAD_TO_LINK.has(doc.type); up++) {
    hits.push(...(index.links.get(doc.id) ?? []));
    doc = doc.parentId ? docs[doc.parentId] : undefined;
  }
  const inWindow = hits.filter((h) => {
    const d = offset(iso, h.date);
    return d >= -LINK_WINDOW.before && d <= LINK_WINDOW.after;
  });
  const rank = (h: LinkedVote) => (h.kind === "executive" ? 0 : 1e6) + Math.abs(offset(iso, h.date));
  return [...new Set(inWindow)].sort((x, y) => rank(x) - rank(y));
}

export function offset(fromISO: string, toISO: string): number {
  return Math.round((Date.parse(toISO) - Date.parse(fromISO)) / 86_400_000);
}

export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 86_400_000).toISOString().slice(0, 10);
}
