// What a decision model is asked about a Stale Dates claim, shared by the atlas
// worker (./compute.ts) and the eval that measured it (pnpm eval:vote-evidence),
// so the thresholds in src/lib/votes/overlay.ts stay fitted to the questions
// production sends. Pure: the callers send them.
//
// Two tasks:
// - subject: a sentence that credits an action to a dated Executive Vote, and
//   the executive the rules matched it to. Does that executive carry it?
// - poll: a dated claim that names no Executive Vote. Which passed governance
//   poll near its date authorised it? The candidates are the passed polls inside
//   POLL_WINDOW, ranked lexically and cut to the top K.

import { stripMarkdownLinks } from "../../lib/atlasHelpers.ts";
import type { DateClaim } from "../../lib/staleDates.ts";
import type { Executive, Poll } from "../../lib/votes/types.ts";
import { offset, pollPassed } from "../../lib/votes/vote-index.ts";
import type { JevQuestion } from "../jev.ts";
import { rankLexically } from "./lexical.ts";

// Executive sections go whole: a Prime proxy-spell section runs to 12 KB and
// itemises grant payments deep inside it, and whole executives stay under
// 20 KB. The cap only guards a pathological file.
const SECTION_CHARS = 40_000;
const POLL_CHARS = 6000;
// The claim's own document, for the address or alias that ties a renamed agent to the vote.
const DOCUMENT_CHARS = 3000;
const SENTENCE_END = /[.!?](?=\s+[A-Z(])/g;
const MAX_SENTENCE = 700;

/** Days before and after a claim's date a poll may fall and still be a candidate. */
export const POLL_WINDOW = { before: 120, after: 60 } as const;
/** Candidate polls per claim. */
export const POLL_CANDIDATES = 8;

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

/** A document's whole text, links reduced to their words, whitespace collapsed. */
export function documentText(content: string): string {
  return stripMarkdownLinks(content).replace(/\s+/g, " ").trim();
}

export interface ClaimInput {
  title: string;
  date: string;
  sentence: string;
}

export interface SubjectInput extends ClaimInput {
  documentText: string;
  vote: Pick<Executive, "title" | "summary" | "sections">;
}

export function subjectState(c: SubjectInput) {
  return {
    claim: { sentence: c.sentence, atlas_document_title: c.title, atlas_document_text: c.documentText.slice(0, DOCUMENT_CHARS), vote_date_named: c.date },
    executive_vote: {
      title: c.vote.title,
      summary: c.vote.summary,
      sections: c.vote.sections.map((s) => ({ heading: s.heading.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1"), text: s.text.slice(0, SECTION_CHARS) })),
    },
  };
}

export const SUBJECT_QUESTIONS: Record<"anchor" | "carried", JevQuestion> = {
  anchor: {
    type: "noul",
    instructions:
      "Does the sentence in `claim.sentence` use the Executive Vote it names only as a point in time — a start date or deadline for some other requirement — rather than stating that the vote itself carried out an action?",
  },
  carried: {
    type: "noul",
    instructions:
      "Does the executive vote in `executive_vote` carry out the specific action that `claim.sentence` says this vote carried out? Count an action inside a Prime Agent proxy spell section the executive itemises. A party may appear under an earlier name; treat it as the same party when an address or alias in `claim.atlas_document_text` ties them. Answer no when the executive performs similar actions only for other parties, amounts or assets than the sentence names.",
  },
};

export interface PollCandidate {
  id: string; // p0…pK, the handle the model answers with
  file: string;
  date: string;
  title: string;
  body: string;
}

export interface PollInput extends ClaimInput {
  candidates: PollCandidate[];
}

/** The passed polls in POLL_WINDOW of the claim, most similar first, cut to `k`; `windowFiles` is every one before the cut. */
export function pollCandidates(c: ClaimInput, polls: readonly Poll[], bodies: ReadonlyMap<string, string>, k = POLL_CANDIDATES) {
  const inWindow = polls.filter((p) => {
    const d = offset(c.date, p.date);
    return pollPassed(p) && d >= -POLL_WINDOW.before && d <= POLL_WINDOW.after;
  });
  const texts = inWindow.map((p) => `${p.title} ${p.summary} ${bodies.get(p.file) ?? ""}`);
  const candidates: PollCandidate[] = rankLexically(`${c.title} ${c.sentence}`, texts)
    .slice(0, k)
    .map((i, n) => {
      const p = inWindow[i];
      return { id: `p${n}`, file: p.file, date: p.date, title: p.title, body: bodies.get(p.file) ?? p.summary };
    });
  return { candidates, windowFiles: inWindow.map((p) => p.file) };
}

export function pollState(c: PollInput) {
  return {
    claim: { sentence: c.sentence, atlas_document_title: c.title, date: c.date },
    polls: c.candidates.map((p) => ({ date: p.date, title: p.title, body: p.body.slice(0, POLL_CHARS) })),
  };
}

/** One Noul per candidate, `polls[i]` by position; ids match the candidates' `p<i>`. */
export function pollQuestions(c: PollInput): Record<string, JevQuestion> {
  return Object.fromEntries(
    c.candidates.map((p, i) => [
      p.id,
      {
        type: "noul" as const,
        instructions:
          `Does the governance poll \`polls[${i}]\` authorise, set or change the specific dated arrangement described in \`claim.sentence\` — ` +
          "the same arrangement, parties and date — rather than only editing other parts of the same document or a similar arrangement for someone else?",
      },
    ]),
  );
}
