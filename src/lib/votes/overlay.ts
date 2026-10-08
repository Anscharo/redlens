// The atlas worker's refinements to vote evidence (src/server/sync-vote-evidence.ts)
// and the merge that lays them over the rules' verdicts (./evidence.ts). Pure;
// shared by the browser, the server report tool and the worker, so all three
// read a claim the same way.
//
// Each refinement is used where docs/research/vote-matching/second-voice-eval.md
// measured it beating the rules:
// - A claim naming an Executive Vote: a decision model judges whether the
//   matched executive carried it. It follows a renamed party through the
//   address in the claim's document, which the subject check cannot.
// - A claim naming none: the atlas commit that first wrote it names a pull
//   request, and the passed poll linking that pull request authorised it. Only
//   when history finds none does the model pick among nearby polls.

import type { DateClaim, StaleDatesReport } from "../staleDates";
import type { VoteEvidence, VoteEvidenceStatus, VoteMatch } from "./evidence";
import type { PollRef } from "./polls";
import { offset } from "./vote-index";

/** A judged executive carried the claim at or above this probability (the eval's best band was 0.3–0.4). */
export const CARRIED_THRESHOLD = 0.35;
/** At or above this, the sentence uses the vote only as a point in time and names nothing it carried. */
export const ANCHOR_THRESHOLD = 0.5;
/** The lowest probability a model's poll pick counts at (the eval's best, with no false match). */
export const POLL_THRESHOLD = 0.15;

export interface VoteEvidenceOverlay {
  /** The atlas commit whose documents the worker read. */
  atlasSha: string;
  computedAt: string;
  /** Final evidence per claim, keyed by claimKey(). A claim missing here keeps the rules' verdict. */
  claims: Record<string, VoteEvidence>;
}

interface ClaimIdentity {
  docId: string;
  dateISO: string;
  context: string;
}

/**
 * A claim's key: its document, date and the words around the date, so two
 * mentions of one date in a document stay apart and an edited sentence drops
 * its old verdict instead of inheriting it.
 */
export function claimKey(c: ClaimIdentity): string {
  return `${c.docId}@${c.dateISO}#${fnv1a(c.context)}`;
}

function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, "0");
}

export interface SubjectJudgment {
  model: string;
  anchor: number;
  carried: number;
}

/** A date-matched claim's verdict once the model has judged it; `cast` says whether the matched executive's spell has been cast. */
export function judgeSubject(rule: VoteEvidence, cast: boolean, j: SubjectJudgment): VoteEvidence {
  const anchor = j.anchor >= ANCHOR_THRESHOLD;
  let status: VoteEvidenceStatus = anchor ? "vote-on-date" : "enacted";
  if (!anchor && j.carried < CARRIED_THRESHOLD) status = "subject-missing";
  else if (!cast) status = "pending";
  return { ...rule, status, judged: { model: j.model, p: anchor ? j.anchor : j.carried, rule: rule.status } };
}

/** Authorised by the poll that linked the pull request first writing the claim. */
export function historyEvidence(dateISO: string, poll: PollRef): VoteEvidence {
  return { status: "authorised", via: "history", vote: pollMatch(dateISO, poll), subject: null };
}

/** The model's poll pick, or the rules' verdict when no candidate reached POLL_THRESHOLD. */
export function judgePoll(rule: VoteEvidence, dateISO: string, model: string, scored: Array<{ poll: PollRef; p: number | null }>): VoteEvidence {
  let best: { poll: PollRef; p: number } | null = null;
  for (const { poll, p } of scored) if (p !== null && p >= POLL_THRESHOLD && (!best || p > best.p)) best = { poll, p };
  if (!best) return rule;
  return { status: "authorised", via: "judge", vote: pollMatch(dateISO, best.poll), subject: null, judged: { model, p: best.p, rule: rule.status } };
}

function pollMatch(dateISO: string, poll: PollRef): VoteMatch {
  return { kind: "poll", title: poll.title, date: poll.date, url: poll.url, offsetDays: offset(dateISO, poll.date) };
}

/** The claim with the worker's verdict when the overlay holds one. */
export function overlayClaim<C extends DateClaim>(c: C, overlay: VoteEvidenceOverlay | null): C {
  const e = overlay?.claims[claimKey(c)];
  return e ? { ...c, voteEvidence: e } : c;
}

/** The report with the worker's verdict on every claim it judged; a null overlay leaves it as is. */
export function applyOverlay(report: StaleDatesReport, overlay: VoteEvidenceOverlay | null): StaleDatesReport {
  if (!overlay) return report;
  const lay = (claims: DateClaim[]) => claims.map((c) => overlayClaim(c, overlay));
  return { ...report, stale: lay(report.stale), dueSoon: lay(report.dueSoon), upcoming: lay(report.upcoming), recorded: lay(report.recorded) };
}
