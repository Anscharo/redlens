// Completeness contract (docs/plans/chat-class-completeness.md): a superlative
// or exhaustive question whose answer names a unique oldest/newest or a complete
// set is only grounded if this turn listed the class (untruncated atlas_filter)
// or reduced it in SQL (class-mode atlas_first_seen). Ranked search plus a
// hedge ("among those queried") is the incident's verifier-escape — it still
// fails. Unverified on an exhaustive question is a hard fail (unlike absence,
// whose unverified is a warn). Recovery is not built (docs/plans/
// chat-class-completeness.md, not started); a badge-only harness has nothing
// to rewrite, so any future recovery here means re-running retrieval
// (requery), not resurrecting a rewrite path.

import {
  COMPLETENESS_REQUERY_STEER,
  answerAssertsCompleteness,
  classGrounding,
  parseJson,
  questionNeedsClass,
  type CompletenessAudit,
  type CompletenessEvidence,
} from "./completeness-signals";

export {
  CLASS_COMPLETENESS_Q_RE,
  COMPLETENESS_REQUERY_STEER,
  EXTREMUM_Q_RE,
  answerAssertsCompleteness,
  isClassModeFirstSeen,
  isCompleteFilterListing,
  isCompleteReportListing,
  questionNeedsClass,
  type CompletenessAudit,
  type CompletenessEvidence,
  type CompletenessOutcome,
} from "./completeness-signals";
export { scoreCompletenessToolChoice, type ToolChoiceCall } from "./completeness-tool-choice";

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function claimedUuids(answer: string): string[] {
  return [...answer.matchAll(UUID_RE)].map((m) => m[0].toLowerCase());
}

function claimedCount(answer: string): number | null {
  const m = answer.match(/\ball\s+(\d+)/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function refuteAgainst(answer: string, e: CompletenessEvidence): string | null {
  const body = parseJson(e.content);
  if (!body) return null;
  if ((e.tool === "atlas_filter" || e.tool.startsWith("atlas_report_")) && typeof body.total === "number") {
    const n = claimedCount(answer);
    if (n != null && n !== body.total) {
      return `listing total is ${body.total} but the answer claimed all ${n}`;
    }
  }
  if (e.tool === "atlas_first_seen" && Array.isArray(body.oldest)) {
    const oldest = body.oldest as Array<{ uuid?: unknown }>;
    const oldestIds = new Set(oldest.map((r) => String(r.uuid ?? "").toLowerCase()).filter(Boolean));
    if (oldestIds.size === 0) return null;
    const named = claimedUuids(answer);
    if (named.length === 1 && !oldestIds.has(named[0])) {
      return `class-mode oldest set does not include claimed ${named[0]}`;
    }
  }
  return null;
}

function groundingDetail(tool: string): string {
  if (tool === "atlas_first_seen") return "class-mode atlas_first_seen";
  return tool.startsWith("atlas_report_") ? "untruncated atlas_report_*" : "untruncated atlas_filter";
}

export function auditCompleteness(
  question: string,
  answer: string,
  evidence: CompletenessEvidence[],
): CompletenessAudit {
  if (!questionNeedsClass(question) || !answerAssertsCompleteness(answer)) {
    return { outcome: "noop", detail: "not an exhaustive/extremum assertion" };
  }
  const ground = classGrounding(evidence);
  if (!ground) return { outcome: "unverified", detail: COMPLETENESS_REQUERY_STEER };
  const clash = refuteAgainst(answer, ground);
  return clash ? { outcome: "refuted", detail: clash } : { outcome: "grounded", detail: groundingDetail(ground.tool) };
}

export function completenessFailuresOf(
  question: string | undefined,
  answer: string,
  evidence: CompletenessEvidence[] | undefined,
): string[] {
  if (!question || !evidence) return [];
  const audit = auditCompleteness(question, answer, evidence);
  if (audit.outcome === "unverified" || audit.outcome === "refuted") return [audit.detail];
  return [];
}
