// Cases for the vote-evidence second-voice eval (eval-vote-evidence.ts), built
// from the live atlas (public/docs.json), the vote record (public/votes.json)
// and the poll bodies, joined to the hand-checked gold in
// eval-corpora/vote-evidence-gold.json. Pure: the entry point does the I/O.
//
// Two tasks:
// - subject: a sentence that credits an action to a dated Executive Vote, and
//   the executive the shipped matcher chose for it. Does that executive carry it?
// - poll: a dated claim that names no Executive Vote. Which passed governance
//   poll, if any, authorised it? Candidates are the passed polls inside
//   POLL_WINDOW, ranked lexically and cut to the top K: the judges choose among
//   them, so the prefilter's recall caps every arm and is reported.

import type { AtlasNode } from "../../src/types.ts";
import { stripMarkdownLinks } from "../../src/lib/atlasHelpers.ts";
import { buildStaleDatesReport, type DateClaim } from "../../src/lib/staleDates.ts";
import type { Executive, Poll, VotesArtifact } from "../../src/lib/votes/types.ts";
import { buildVoteIndex, offset } from "../../src/lib/votes/vote-index.ts";
import { rankLexically } from "./eval-vote-evidence-lexical.ts";

export interface GoldSubject {
  docId: string;
  date: string;
  label: "yes" | "no" | "anchor" | "unclear";
  correct_vote_file: string;
  subject_in_vote: boolean | null;
  evidence: string;
  note?: string;
}

export interface GoldPoll {
  docId: string;
  date: string;
  label: "authorised" | "enacted-only" | "none-expected" | "not-found";
  authorising: string[];
  enacting: string[];
  evidence: string;
  note?: string;
}

export interface Gold {
  subject: GoldSubject[];
  poll: GoldPoll[];
}

export interface ClaimText {
  key: string; // `<docId>@<date>`
  docId: string;
  docNo: string;
  title: string;
  date: string;
  sentence: string;
  claim: DateClaim;
}

export interface SubjectCase extends ClaimText {
  vote: Executive;
  gold: GoldSubject | null;
}

export interface PollCandidate {
  id: string; // p0…pK, the handle the judges answer with
  file: string;
  date: string;
  title: string;
  body: string;
}

export interface PollCase extends ClaimText {
  candidates: PollCandidate[];
  /** Passed polls in the window, before the top-K cut: what the prefilter could have kept. */
  windowFiles: string[];
  gold: GoldPoll | null;
}

/** Days before and after a claim's date a poll may fall and still be a candidate. */
export const POLL_WINDOW = { before: 120, after: 60 } as const;
const SENTENCE_END = /[.!?](?=\s+[A-Z(])/g;
const MAX_SENTENCE = 700;

/** The whole sentence holding the claim's date, from link-stripped, whitespace-collapsed prose. */
export function claimSentence(content: string, c: Pick<DateClaim, "context" | "contextBefore" | "raw">): string {
  const prose = stripMarkdownLinks(content).replace(/\s+/g, " ");
  const at = prose.indexOf(c.context);
  const date = at === -1 ? prose.indexOf(c.raw) : at + c.contextBefore.length;
  if (date === -1) return c.context;
  let start = 0;
  for (const m of prose.slice(0, date).matchAll(SENTENCE_END)) start = (m.index ?? 0) + 1;
  const rest = prose.slice(date);
  const end = rest.search(SENTENCE_END);
  return prose.slice(start, end === -1 ? undefined : date + end + 1).trim().slice(0, MAX_SENTENCE);
}

const keyOf = (docId: string, date: string) => `${docId}@${date}`;

function claimText(c: DateClaim, docs: Record<string, AtlasNode>): ClaimText {
  const doc = docs[c.docId];
  return { key: keyOf(c.docId, c.dateISO), docId: c.docId, docNo: c.docNo, title: c.title, date: c.dateISO, sentence: claimSentence(doc.content, c), claim: c };
}

function passed(p: Poll): boolean {
  const w = p.portal?.winner;
  return !!w && !/^(no|against|reject)/i.test(w);
}

function pollCase(base: ClaimText, polls: Poll[], bodies: Map<string, string>, k: number, gold: GoldPoll | null): PollCase {
  const inWindow = polls.filter((p) => {
    const d = offset(base.date, p.date);
    return passed(p) && d >= -POLL_WINDOW.before && d <= POLL_WINDOW.after;
  });
  const docs = inWindow.map((p) => `${p.title} ${p.summary} ${bodies.get(p.file) ?? ""}`);
  const ranked = rankLexically(`${base.title} ${base.sentence}`, docs).slice(0, k);
  const candidates = ranked.map((i, n) => {
    const p = inWindow[i];
    return { id: `p${n}`, file: p.file, date: p.date, title: p.title, body: bodies.get(p.file) ?? p.summary };
  });
  return { ...base, candidates, windowFiles: inWindow.map((p) => p.file), gold };
}

/**
 * Every subject and poll case the current atlas yields, joined to gold by
 * doc uuid and date. Gold rows whose claim the atlas no longer contains are
 * returned as `staleGold` so a rewritten sentence reads as such, not as a miss.
 */
export function buildCases(
  docs: Record<string, AtlasNode>,
  artifact: VotesArtifact,
  pollBodies: Map<string, string>,
  gold: Gold,
  opts: { today: Date; k: number },
): { subject: SubjectCase[]; poll: PollCase[]; staleGold: string[] } {
  const report = buildStaleDatesReport(docs, opts.today, buildVoteIndex(artifact));
  const claims = [...report.stale, ...report.dueSoon, ...report.upcoming, ...report.recorded];
  const goldA = new Map(gold.subject.map((g) => [keyOf(g.docId, g.date), g]));
  const goldB = new Map(gold.poll.map((g) => [keyOf(g.docId, g.date), g]));
  const subject: SubjectCase[] = [];
  const poll: PollCase[] = [];
  for (const c of claims) {
    const base = claimText(c, docs);
    const m = c.voteEvidence?.vote;
    const vote = m && artifact.executives.find((e) => e.date === m.date && e.title === m.title);
    if (c.vote && vote) subject.push({ ...base, vote, gold: goldA.get(base.key) ?? null });
    else if (!c.vote) poll.push(pollCase(base, artifact.polls, pollBodies, opts.k, goldB.get(base.key) ?? null));
  }
  const seen = new Set(claims.map((c) => keyOf(c.docId, c.dateISO)));
  const staleGold = [...goldA.keys(), ...goldB.keys()].filter((k) => !seen.has(k));
  return { subject, poll, staleGold };
}
