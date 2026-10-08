// Words for vote evidence, shared by the Stale Dates page, its CSV, its text
// filter and the chat tool, so all four say the same thing.

import type { VoteEvidence, VoteEvidenceStatus, VoteMatch } from "./evidence";

/** How a vote's kind reads to a user: the atlas's own term, never shortened to "executive". */
export const VOTE_KIND: Record<VoteMatch["kind"], string> = { executive: "Executive Vote", poll: "poll" };

// In the atlas's own terms: an Executive Vote "includes" changes and is
// "executed" (A.1.11.1.3.0.3.3, A.1.10.2.1.4); its Spell executes them
// (A.1.11.1.2.2); a Governance Poll pre-approves them.
export const EVIDENCE_LABEL: Record<VoteEvidenceStatus, string> = {
  enacted: "executed",
  "vote-on-date": "Executive Vote on date",
  pending: "not yet executed",
  "subject-missing": "not included",
  "no-vote": "no Executive Vote on date",
  "not-covered": "outside vote record",
  authorised: "approved by poll",
  unlinked: "no linked vote",
};

export const EVIDENCE_HINT: Record<VoteEvidenceStatus, string> = {
  enacted: "An Executive Vote carried this claim, and its spell has been cast on-chain.",
  "vote-on-date":
    "An Executive Vote on this date had its spell cast on-chain, but the sentence names nothing specific enough to check against it.",
  pending: "The matching Executive Vote is drafted or still being voted on; its spell has not been cast.",
  "subject-missing":
    "An Executive Vote is filed for this date, but it never mentions what the atlas says it carried.",
  "no-vote": "The vote record covers this date and holds no Executive Vote for it.",
  "not-covered": "The date falls outside the span of the vote record, so it cannot confirm or refute the claim.",
  authorised: "A passed governance poll links this document; no Executive Vote does.",
  unlinked:
    "No vote names this date or links this document. Not evidence of absence: most effective dates are set by weekly polls that link nothing.",
};

// What the vote was found through, where the status hint alone would mislead.
const VIA_HINT: Partial<Record<NonNullable<VoteEvidence["via"]>, string>> = {
  history: "The atlas change that first wrote this claim came from a pull request this passed poll links.",
  judge: "An AI model picked this passed poll, among those near the date, as the one authorising the claim.",
};

/** The tooltip for an evidence tag: what the status means, how the vote was found, and what the heuristic said where the AI overruled it. */
export function evidenceHint(e: VoteEvidence): string {
  const parts = [VIA_HINT[e.via ?? "date"] ?? EVIDENCE_HINT[e.status]];
  const a = e.subject?.address;
  if (a) parts.push(`The vote names the party differently, but sends to ${a.slice(0, 6)}…${a.slice(-4)}, the address the claim's document gives.`);
  if (e.judged) parts.push(`Checked by an AI model (${e.judged.model}, p ${e.judged.p.toFixed(2)}).`);
  if (ruleDisagrees(e)) parts.push(`The heuristic alone said: ${EVIDENCE_LABEL[e.judged!.rule]}.`);
  return parts.join(" ");
}

export type MatchedVia = "date" | "link" | "history" | "AI";

/**
 * How the vote was matched, one word per method: the date the sentence names,
 * a vote linking the document, atlas history, or an AI model. AI wins whenever
 * the model decided the status, whether it confirmed or overruled a date match.
 * Null when no vote matched.
 */
export function matchedVia(e: VoteEvidence): MatchedVia | null {
  if (e.judged) return "AI";
  return e.via === "date" || e.via === "link" || e.via === "history" ? e.via : null;
}

/** Whether the AI overruled the heuristic's verdict on this claim. */
export function ruleDisagrees(e: VoteEvidence): boolean {
  return !!e.judged && e.judged.rule !== e.status;
}

/**
 * The subject terms the matched vote lacks, shown only when that decided the
 * status: an enacted claim can still miss a minor term, and listing it there
 * would read as a warning.
 */
export function missingSubject(e: VoteEvidence): string[] {
  return e.status === "subject-missing" ? (e.subject?.missing ?? []) : [];
}

/** One line for a filter or the chat: the label, the vote and its offset, how it was matched, and any decisive missing terms. */
export function evidenceText(e: VoteEvidence): string {
  const parts = [EVIDENCE_LABEL[e.status]];
  if (e.vote) parts.push(`${VOTE_KIND[e.vote.kind]} ${e.vote.date} (${signedDays(e.vote.offsetDays)})`);
  const via = matchedVia(e);
  if (via) parts.push(`via ${via}`);
  const missing = missingSubject(e);
  if (missing.length) parts.push(`missing: ${missing.join(", ")}`);
  return parts.join(" · ");
}

export function signedDays(n: number): string {
  return `${n >= 0 ? "+" : "−"}${Math.abs(n)}d`;
}
