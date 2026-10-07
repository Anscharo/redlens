// Labels and scores for the vote-evidence eval. Pure.
//
// Subject task: each arm answers yes / no / anchor, or abstains ("unchecked"
// for the shipped matcher, "unclear" for the LLM) or errors. Accuracy is over
// the answered cases; coverage says how many that was. Gold "unclear" rows are
// left out. The swapped slice pairs each confirmed claim with an executive that
// does not carry it, so every arm's false-alarm side is measured on more than
// the handful of real negatives.
//
// Poll task: each arm names one candidate poll or "none". Correct when it names
// a gold authorising poll, or says none where gold has none.

import type { Executive } from "../../src/lib/votes/types.ts";
import { offset } from "../../src/lib/votes/vote-index.ts";
import type { PollCase, SubjectCase } from "./eval-vote-evidence-cases.ts";

export type SubjectLabel = "yes" | "no" | "anchor" | "abstain" | "error";

export function heuristicSubject(c: SubjectCase): SubjectLabel {
  const e = c.claim.voteEvidence;
  if (c.claim.vote?.anchor) return "anchor";
  if (e?.status === "subject-missing") return "no";
  return e?.subject ? "yes" : "abstain";
}

export function jevSubject(anchorP: number | null, carriedP: number | null, tau: number): SubjectLabel {
  if (anchorP === null || carriedP === null) return "error";
  if (anchorP >= 0.5) return "anchor";
  return carriedP >= tau ? "yes" : "no";
}

export interface SubjectScore {
  n: number;
  answered: number;
  correct: number;
  accuracy: number | null;
  coverage: number | null;
  /** Gold "no" cases the arm called "no". */
  caught: string;
  /** Arm said "no" where gold says "yes". */
  falseAlarms: number;
}

const ratio = (a: number, b: number) => (b ? a / b : null);

export function scoreSubject(rows: Array<{ gold: string; pred: SubjectLabel }>): SubjectScore {
  const scored = rows.filter((r) => r.gold !== "unclear");
  const answered = scored.filter((r) => r.pred !== "abstain" && r.pred !== "error");
  const correct = answered.filter((r) => r.pred === r.gold).length;
  const negatives = scored.filter((r) => r.gold === "no");
  return {
    n: scored.length,
    answered: answered.length,
    correct,
    accuracy: ratio(correct, answered.length),
    coverage: ratio(answered.length, scored.length),
    caught: `${negatives.filter((r) => r.pred === "no").length}/${negatives.length}`,
    falseAlarms: scored.filter((r) => r.gold === "yes" && r.pred === "no").length,
  };
}

/**
 * The executive at least `minDays` from the claim, nearest first, whose text
 * lacks the gold evidence line: a vote that does not carry the claim.
 */
export function swapExecutive(c: SubjectCase, executives: readonly Executive[], evidence: string, minDays = 45): Executive | null {
  const needle = evidence.replace(/\s+/g, " ").slice(0, 60).toLowerCase();
  const text = (e: Executive) => [e.title, e.summary, ...e.sections.map((s) => `${s.heading} ${s.text}`)].join(" ").replace(/\s+/g, " ").toLowerCase();
  const far = executives.filter((e) => Math.abs(offset(c.date, e.date)) >= minDays && e.portal);
  far.sort((a, b) => Math.abs(offset(c.date, a.date)) - Math.abs(offset(c.date, b.date)));
  return far.find((e) => !needle || !text(e).includes(needle)) ?? null;
}

export function heuristicPoll(c: PollCase, pollFileByTitle: Map<string, string>): string {
  const e = c.claim.voteEvidence;
  return e?.status === "authorised" && e.vote ? (pollFileByTitle.get(`${e.vote.date}|${e.vote.title}`) ?? "none") : "none";
}

/** The candidate whose Noul is highest, if it clears `tau`; "none" otherwise; null when Jev failed. */
export function jevPoll(c: PollCase, nouls: Record<string, number | null> | null, tau: number): string | null {
  if (!nouls) return null;
  let best: { file: string; p: number } | null = null;
  for (const cand of c.candidates) {
    const p = nouls[cand.id];
    if (p !== null && p !== undefined && p >= tau && (!best || p > best.p)) best = { file: cand.file, p };
  }
  return best?.file ?? "none";
}

export interface PollScore {
  n: number;
  correct: number;
  accuracy: number | null;
  /** Gold-authorised claims the arm matched to an authorising poll. */
  found: string;
  /** Claims with no authorising poll where the arm named one anyway. */
  falseMatches: string;
  errors: number;
}

export function scorePoll(rows: Array<{ acceptable: string[]; pred: string | null }>): PollScore {
  const ok = (r: { acceptable: string[]; pred: string | null }) =>
    r.pred !== null && (r.acceptable.length ? r.acceptable.includes(r.pred) : r.pred === "none");
  const pos = rows.filter((r) => r.acceptable.length);
  const neg = rows.filter((r) => !r.acceptable.length);
  const correct = rows.filter(ok).length;
  return {
    n: rows.length,
    correct,
    accuracy: ratio(correct, rows.length),
    found: `${pos.filter(ok).length}/${pos.length}`,
    falseMatches: `${neg.filter((r) => r.pred !== null && r.pred !== "none").length}/${neg.length}`,
    errors: rows.filter((r) => r.pred === null).length,
  };
}

/** Whether the prefilter kept a gold authorising poll: in the top-K candidates, and anywhere in the window. */
export function prefilterRecall(cases: readonly PollCase[]): { topK: string; window: string } {
  const pos = cases.filter((c) => c.gold && c.gold.authorising.length);
  const has = (files: string[], c: PollCase) => c.gold!.authorising.some((f) => files.includes(f));
  return {
    topK: `${pos.filter((c) => has(c.candidates.map((p) => p.file), c)).length}/${pos.length}`,
    window: `${pos.filter((c) => has(c.windowFiles, c)).length}/${pos.length}`,
  };
}
