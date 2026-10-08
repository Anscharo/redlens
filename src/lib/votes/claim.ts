// The atlas side of a vote match: whether a dated mention names an Executive
// Vote, whether it uses that vote only as a point in time, and which named
// things the sentence says the vote carried. Pure; reads link-stripped prose.

import { subjectTerms } from "./subject";

export interface VoteRef {
  outOfSchedule: boolean;
  /**
   * The sentence dates something else by the vote ("Beginning with the June 18,
   * 2026 Executive Vote, a checklist must …") rather than saying what the vote
   * did, so the executive is not expected to mention the subject.
   */
  anchor: boolean;
  /** Lowercased named terms of the clause that says what the vote carried. */
  subject: string[];
}

// The words right after the date: "<date> Executive Vote", "<date> Out-Of-Schedule Executive Vote".
const NAMES_EXECUTIVE_RE = /^,?\s+(out[- ]of[- ]schedule\s+)?executive\s+votes?\b/i;
const ANCHOR_RE =
  /\b(?:(?:beginning|starting|commencing)\s+with|execution\s+of|following|after|before|prior\s+to|until|from|since)\s+the\s*$/i;
// A sentence ends at terminal punctuation followed by a capital, or at a line break.
const SENTENCE_END_RE = /[.!?](?=\s+[A-Z(])|\n/g;

/** The vote reference for the date at [start, end) of `prose`, or null when the date does not name an Executive Vote. */
export function executiveVoteRef(prose: string, start: number, end: number): VoteRef | null {
  const after = prose.slice(end, end + 48);
  const named = NAMES_EXECUTIVE_RE.exec(after);
  if (!named) return null;
  const sentenceStart = lastBoundary(prose.slice(0, start));
  const before = prose.slice(sentenceStart, start);
  const rest = prose.slice(end + named[0].length);
  const sentenceEnd = firstBoundary(rest);
  // The subject normally precedes the date ("The transfer … was included in
  // the <date> Executive Vote"); a sentence that opens with the date names it after.
  const lead = subjectTerms(before);
  return {
    outOfSchedule: !!named[1],
    anchor: ANCHOR_RE.test(before),
    subject: lead.length ? lead : subjectTerms(rest.slice(0, sentenceEnd)),
  };
}

function lastBoundary(text: string): number {
  let at = 0;
  for (const m of text.matchAll(SENTENCE_END_RE)) at = (m.index ?? 0) + 1;
  return at;
}

function firstBoundary(text: string): number {
  const m = text.search(SENTENCE_END_RE);
  return m === -1 ? text.length : m + 1;
}
