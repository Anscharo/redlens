// Eval / bakeoff tool-choice arm of the completeness contract: the failure is
// search-then-ids, not a prose miss. Fail if the first class-shaped call is
// ranked retrieval, or if first_seen ran only with search ids. Pass on
// filter-by-title or class-mode first_seen before the answer; a listing used
// for "all" must not be has_more.
import { hasClassArgs, hasIdsArgs, questionNeedsClass } from "./completeness-signals";

export interface ToolChoiceCall {
  name: string;
  args: Record<string, unknown>;
  result?: Record<string, unknown>;
}

type Verdict = { pass: boolean; reason: string };

const LISTING_Q_RE = /\ball\b|\bevery\b|how many/i;

function isRankedOnly(call: ToolChoiceCall): boolean {
  if (call.name === "atlas_search") return true;
  if (call.name !== "atlas_query") return false;
  const q = call.args.q ?? call.args.search ?? call.args.query;
  if (typeof q !== "string" || !q) return false;
  return !hasClassArgs(call.args) && call.args.target_type == null;
}

function isMembershipCall(call: ToolChoiceCall): boolean {
  return (
    call.name === "atlas_search" ||
    call.name === "atlas_query" ||
    call.name === "atlas_filter" ||
    call.name === "atlas_first_seen" ||
    call.name.startsWith("atlas_report_")
  );
}

function firstCallFailure(first: ToolChoiceCall): Verdict | null {
  if (isRankedOnly(first)) {
    return { pass: false, reason: `first membership call was ${first.name} with ranked q — not a census` };
  }
  if (first.name === "atlas_first_seen" && hasIdsArgs(first.args) && !hasClassArgs(first.args)) {
    return { pass: false, reason: "atlas_first_seen ran in ids mode (search-sized batch), not class mode" };
  }
  return null;
}

function filterVerdict(filter: ToolChoiceCall, exhaustive: boolean): Verdict {
  if (filter.result?.has_more !== true && filter.result?.truncated !== true) {
    return { pass: true, reason: "complete atlas_filter listing" };
  }
  const reason = exhaustive
    ? "atlas_filter listing used for an exhaustive question was incomplete (has_more/truncated)"
    : "atlas_filter listing was incomplete";
  return { pass: false, reason };
}

function reportVerdict(report: ToolChoiceCall, exhaustive: boolean): Verdict {
  if (report.result?.truncated !== true) return { pass: true, reason: "untruncated atlas_report_* listing" };
  const reason = exhaustive
    ? "atlas_report_* listing used for an exhaustive question was truncated"
    : "atlas_report_* listing was truncated";
  return { pass: false, reason };
}

/** An exhaustive question is judged on its listing first; otherwise class-mode first_seen wins. */
function listingVerdict(question: string, calls: ToolChoiceCall[]): Verdict {
  const filter = calls.find((c) => c.name === "atlas_filter");
  const report = calls.find((c) => c.name.startsWith("atlas_report_"));
  const exhaustive = LISTING_Q_RE.test(question);
  if (exhaustive && filter) return filterVerdict(filter, true);
  if (exhaustive && report) return reportVerdict(report, true);
  if (calls.some((c) => c.name === "atlas_first_seen" && hasClassArgs(c.args) && !hasIdsArgs(c.args))) {
    return { pass: true, reason: "class-mode atlas_first_seen" };
  }
  if (filter) return filterVerdict(filter, false);
  if (report) return reportVerdict(report, false);
  return { pass: false, reason: "no complete class listing or class-mode first_seen" };
}

export function scoreCompletenessToolChoice(question: string, calls: ToolChoiceCall[]): Verdict {
  if (!questionNeedsClass(question)) return { pass: true, reason: "not a class question" };
  const membership = calls.filter(isMembershipCall);
  if (membership.length === 0) return { pass: false, reason: "no class listing or first_seen call" };
  return firstCallFailure(membership[0]!) ?? listingVerdict(question, calls);
}
