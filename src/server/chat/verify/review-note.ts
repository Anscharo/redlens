// What the READER sees under an assistant answer, rendered for the model.
//
// The chat replays the whole thread but only four columns of it (chat.ts's
// history SELECT: id, role, content, tool_calls). The browser additionally shows
// a verification badge and its findings, the Sources chips, and an
// answer-coverage line — none of which reach the model. So when a user points at
// the screen ("why was verification failed?") the model has never seen the thing
// being pointed at, and answers with speculation. Observed in a real transcript:
// that exact question produced three guesses and a clarifying question, and the
// next answer was correct only because the user pasted the failure text by hand.
//
// This module turns one message's stored check rows into the short note that goes
// back in. It is PURE and never throws: every reader it calls already degrades to
// null on a malformed payload (persisted-verdict.ts's contract), and a message
// with nothing worth saying returns null rather than an empty shell.
//
// The strings are NOT re-authored here. describeFindings (verify/incremental.ts)
// already mirrors apps/web/src/components/chat/VerifyFindings.tsx sentence for
// sentence, so it is reused for every finding it covers and only the four it does
// not are added below. Badge labels mirror VerifyBadge.tsx's chipLabel and the
// coverage wording mirrors confidenceFacts.ts's answerFacts; those live in the
// separate web project and cannot be imported, so review-note.test.ts pins them.
import { describeFindings } from "./incremental.ts";
import { restoreVerify, answerCoverageFromRow, judgedPairsFrom, type VerifyOut, type AnswerCoverageOut } from "./persisted-verdict.ts";
import { aggregateMarks, shownMarks, type CitationMark } from "./citation-marks.ts";
import { withoutDisputedMarks } from "./disputes.ts";

/** Caps, so a ledger of these can never grow without bound. See review-round.ts. */
export const MAX_FINDINGS = 6;
export const FINDING_CHARS = 180;
export const COVERAGE_CHARS = 200;
export const MAX_MARKS = 4;
export const MARK_CHARS = 70;

export interface ReviewNote {
  /** Mirrors VerifyBadge's chipLabel — the words actually on the chip. */
  badge: string;
  findings: string[];
  /** Agreed contradictions, newest-answer only; the caller decides whether to render them. */
  disputes: VerifyOut["contradictions"];
  coverage: string | null;
  marks: string[];
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * VerifyBadge.tsx chipLabel, for the two statuses that reach a reader. "checking"
 * is transient and "unverified" renders no badge at all, so neither can appear in
 * a stored row the reader saw.
 */
export function badgeLabel(verify: VerifyOut): string | null {
  if (verify.status === "pass") return "verified";
  if (verify.status === "fail") {
    const n = verify.contradictions.length;
    return n > 0 ? `${n} statement${n === 1 ? "" : "s"} disputed by the atlas` : "failed verification";
  }
  if (verify.status === "warn") return "caution: the answer issues a ruling";
  return null;
}

/**
 * The findings list. describeFindings covers eight of the twelve; the other four
 * are booleans and lists it does not take, and their wording is lifted from
 * VerifyFindings.tsx verbatim.
 */
export function findingsOf(verify: VerifyOut): string[] {
  const out = [...describeFindings(verify)];
  if (verify.lengthCapped) out.push("the answer was cut off by the output length limit before it finished");
  for (const d of verify.completenessFailures) out.push(d);
  if (verify.missingExternalDisclaimer) out.push("settlement figures were used without saying they are not from the Atlas");
  if (verify.rulingIssued) out.push("the answer issues a ruling instead of reporting what the atlas says");
  return out.map((f) => clip(f, FINDING_CHARS));
}

/** confidenceFacts.ts's answerFacts: a plain `answers` verdict adds nothing. */
export function coverageOf(coverage: AnswerCoverageOut | null): string | null {
  if (!coverage || coverage.verdict === "answers") return null;
  const head =
    coverage.verdict === "declines"
      ? "declined to answer"
      : coverage.verdict === "deflects"
        ? "answered something adjacent rather than what was asked"
        : "asked a clarifying question instead of answering";
  const missing = coverage.missingParts.length > 0 ? `; didn't address: ${coverage.missingParts.map((p) => `“${p}”`).join(", ")}` : "";
  return clip(head + missing, COVERAGE_CHARS);
}

/**
 * Only the chips that are NOT the quiet default. `shownMarks` has already reduced
 * these to the four statuses that reach a Sources chip, and `backed` is three of
 * every four of them — a ✓ on every cited doc is just what a clean answer looks
 * like, so listing them would spend the whole budget saying nothing. What is left
 * is `disputed`, `unread` and `uncovered`: the chips a reader actually asks about.
 *
 * Identified by uuid PREFIX, not doc number: a CitationMark carries no doc_no
 * (only status, claims and confidence), and resolving one would mean handing this
 * pure module the atlas indexes. The prefix is enough — the model's own prior
 * answer cites the document as `/atlas/<uuid>`, so it can match it there.
 */
export function marksOf(marks: Record<string, CitationMark>): string[] {
  const out: string[] = [];
  for (const [uuid, mark] of Object.entries(marks)) {
    if (mark.status === "backed") continue;
    out.push(clip(`doc ${uuid.slice(0, 8)} marked ${mark.status}`, MARK_CHARS));
    if (out.length >= MAX_MARKS) break;
  }
  return out;
}

/** The formatter half: for callers that already restored these (conversations.ts). */
export function reviewNoteFrom(input: {
  verify: VerifyOut | null;
  coverage: AnswerCoverageOut | null;
  marks: Record<string, CitationMark>;
}): ReviewNote | null {
  // `unverified` renders no badge, so a row in that state is not something the
  // reader saw — but coverage and marks can still be worth replaying on their own.
  const badge = input.verify ? badgeLabel(input.verify) : null;
  const findings = input.verify ? findingsOf(input.verify) : [];
  const coverage = coverageOf(input.coverage);
  const marks = marksOf(input.marks);
  const disputes = input.verify?.contradictions ?? [];
  if (!badge && findings.length === 0 && !coverage && marks.length === 0) return null;
  return {
    badge: badge ?? "",
    findings: findings.slice(0, MAX_FINDINGS).concat(findings.length > MAX_FINDINGS ? [`…and ${findings.length - MAX_FINDINGS} more`] : []),
    disputes,
    coverage,
    marks,
  };
}

export interface CheckRow {
  kind: string;
  verdict: unknown;
  overall: string | null;
}

/**
 * One message's rows → its note. Restores through the SAME readers the browser
 * uses on reload, so the model and the reader can never disagree about what the
 * badge said: restoreVerify recomputes computeOverall rather than trusting the
 * stored `overall` (persisted-verdict.ts:262), and the marks are reconciled
 * against the agreed contradictions exactly as the live wire event is.
 */
export function reviewNoteFromChecks(rows: CheckRow[]): ReviewNote | null {
  const verifyRow = rows.find((r) => r.kind === "verify") ?? null;
  const roundChecks = rows.find((r) => r.kind === "round_checks")?.verdict ?? null;
  const verify = restoreVerify(verifyRow ? { verdict: verifyRow.verdict, overall: verifyRow.overall } : null, roundChecks);

  const coverage = answerCoverageFromRow(rows.find((r) => r.kind === "answer_coverage")?.verdict ?? null);

  const judged = judgedPairsFrom(rows.find((r) => r.kind === "citation_check")?.verdict ?? null);
  // aggregateMarks wants the full JudgedPair shape; judgedPairsFrom returns
  // exactly that minus nothing, and an unconfirmed contradiction is dropped
  // before the fold the same way citation-marks.ts drops it live.
  //
  // withoutDisputedMarks is here for parity with the wire event and is currently
  // a NO-OP in this path: the only statuses it rewrites are the check-drawing
  // ones, and marksOf drops every `backed` mark as the quiet default before any
  // of them could be reported. It stays because the day marksOf reports a check,
  // the reconciliation is already correct rather than newly missing — and because
  // one function deciding this for both paths is the point of disputes.ts.
  const marks = judged
    ? withoutDisputedMarks(shownMarks(aggregateMarks(judged.filter((j) => j.confirmed !== false) as Parameters<typeof aggregateMarks>[0])), verify?.contradictions ?? [])
    : {};

  return reviewNoteFrom({ verify, coverage, marks });
}
