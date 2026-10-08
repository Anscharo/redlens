// Cases for the vote-evidence second-voice eval (eval-vote-evidence.ts), built
// from the live atlas (public/docs.json), the vote record (public/votes.json)
// and the poll bodies, joined to the hand-checked gold in
// eval-corpora/vote-evidence-gold.json. Pure: the entry point does the I/O.
//
// Two tasks:
// - subject: a sentence that credits an action to a dated Executive Vote, and
//   the executive the shipped matcher chose for it. Does that executive carry it?
// - poll: a dated claim that names no Executive Vote. Which passed governance
//   poll, if any, authorised it? Candidates are the ones production asks about
//   (src/server/vote-evidence/requests.ts): the judges choose among them, so
//   the prefilter's recall caps every arm and is reported.

import type { AtlasNode } from "../../src/types.ts";
import { buildStaleDatesReport, type DateClaim } from "../../src/lib/staleDates.ts";
import type { Executive, Poll, VotesArtifact } from "../../src/lib/votes/types.ts";
import { buildVoteIndex } from "../../src/lib/votes/vote-index.ts";
import { claimSentence, documentText, pollCandidates, type PollCandidate } from "../../src/server/vote-evidence/requests.ts";

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
  /** The claim's whole document, links reduced to text, whitespace collapsed. */
  documentText: string;
  claim: DateClaim;
}

export interface SubjectCase extends ClaimText {
  vote: Executive;
  gold: GoldSubject | null;
}

export interface PollCase extends ClaimText {
  candidates: PollCandidate[];
  /** Passed polls in the window, before the top-K cut: what the prefilter could have kept. */
  windowFiles: string[];
  gold: GoldPoll | null;
}

const keyOf = (docId: string, date: string) => `${docId}@${date}`;

function claimText(c: DateClaim, docs: Record<string, AtlasNode>): ClaimText {
  const doc = docs[c.docId];
  return {
    key: keyOf(c.docId, c.dateISO), docId: c.docId, docNo: c.docNo, title: c.title, date: c.dateISO,
    sentence: claimSentence(doc.content, c), documentText: documentText(doc.content), claim: c,
  };
}

function pollCase(base: ClaimText, polls: Poll[], bodies: Map<string, string>, k: number, gold: GoldPoll | null): PollCase {
  return { ...base, ...pollCandidates(base, polls, bodies, k), gold };
}

/**
 * Every subject and poll case the current atlas yields, joined to gold by
 * doc uuid and date. Gold rows with no matching claim in the current atlas are
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
  const [goldA, goldB] = [byClaim(gold.subject), byClaim(gold.poll)];
  const [subject, poll]: [SubjectCase[], PollCase[]] = [[], []];
  for (const c of claims) {
    const base = claimText(c, docs);
    const m = c.voteEvidence?.vote;
    const vote = m && artifact.executives.find((e) => e.date === m.date && e.title === m.title);
    if (c.vote && vote) subject.push({ ...base, vote, gold: goldA.get(base.key) ?? null });
    else if (!c.vote) poll.push(pollCase(base, artifact.polls, pollBodies, opts.k, goldB.get(base.key) ?? null));
  }
  return { subject, poll, staleGold: staleGold(claims, [goldA, goldB]) };
}

function byClaim<G extends { docId: string; date: string }>(labels: G[]): Map<string, G> {
  return new Map(labels.map((g) => [keyOf(g.docId, g.date), g]));
}

/** Gold labels matching no claim in the current atlas: relabel or drop them. */
function staleGold(claims: Array<{ docId: string; dateISO: string }>, golds: Array<Map<string, unknown>>): string[] {
  const seen = new Set(claims.map((c) => keyOf(c.docId, c.dateISO)));
  return golds.flatMap((g) => [...g.keys()]).filter((k) => !seen.has(k));
}
