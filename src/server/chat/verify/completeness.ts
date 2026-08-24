// Completeness contract (docs/plans/chat-class-completeness.md): a superlative
// or exhaustive question whose answer names a unique oldest/newest or a complete
// set is only grounded if this turn listed the class (untruncated atlas_filter)
// or reduced it in SQL (class-mode atlas_first_seen). Ranked search plus a
// hedge ("among those queried") is the incident's verifier-escape — it still
// fails. Unverified on an exhaustive question is a hard fail (unlike absence,
// whose unverified is a warn) and recovery must requery, not rewrite.

export type CompletenessOutcome = "grounded" | "refuted" | "unverified" | "noop";

export interface CompletenessAudit {
  outcome: CompletenessOutcome;
  detail: string;
}

export interface CompletenessEvidence {
  tool: string;
  args?: string;
  content: string;
}

// Shared with model-router.ts's STRONG extremum signal. The listing/how-many
// half lives only here — routing already has its own enumeration regexes.
export const EXTREMUM_Q_RE = /oldest|earliest|newest|latest|first-seen/i;
export const CLASS_COMPLETENESS_Q_RE = /oldest|earliest|newest|latest|first-seen|\ball\b|\bevery\b|how many/i;

export const COMPLETENESS_REQUERY_STEER =
  "the class was not listed to completion; call `atlas_filter` or `atlas_first_seen` with a title/type filter (not search ids) before answering.";

const HEDGE_RE = /among (those|the) (queried|retrieved|returned|searched|found)|among (the )?(documents|docs|results|hits) I (retrieved|queried|found|returned)/i;
const EXTREMUM_ANSWER_RE = /\b(oldest|earliest|newest|latest|first[- ]seen)\b/i;
const ALL_N_RE = /\ball\s+\d+/i;
const EVERY_RE = /\bevery\b/i;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export function questionNeedsClass(question: string): boolean {
  return CLASS_COMPLETENESS_Q_RE.test(question);
}

export function answerAssertsCompleteness(answer: string): boolean {
  return HEDGE_RE.test(answer) || EXTREMUM_ANSWER_RE.test(answer) || ALL_N_RE.test(answer) || EVERY_RE.test(answer);
}

function parseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function parseJson(raw: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const CLASS_ARG_KEYS = ["title", "title_prefix", "type", "doc_no_pattern", "ancestor_id", "entity"] as const;

function hasClassArgs(args: Record<string, unknown>): boolean {
  return CLASS_ARG_KEYS.some((k) => typeof args[k] === "string" && String(args[k]).length > 0);
}

function hasIdsArgs(args: Record<string, unknown>): boolean {
  return Array.isArray(args.ids) && (args.ids as unknown[]).length > 0;
}

export function isClassModeFirstSeen(e: CompletenessEvidence): boolean {
  if (e.tool !== "atlas_first_seen") return false;
  const args = parseArgs(e.args);
  if (hasIdsArgs(args) || !hasClassArgs(args)) return false;
  const body = parseJson(e.content);
  return body != null && typeof body.class_total === "number";
}

export function isCompleteFilterListing(e: CompletenessEvidence): boolean {
  if (e.tool !== "atlas_filter") return false;
  const body = parseJson(e.content);
  if (!body || typeof body.total !== "number") return false;
  if (body.has_more === true || body.truncated === true) return false;
  return true;
}

function classGrounding(evidence: CompletenessEvidence[]): CompletenessEvidence | null {
  return evidence.find((e) => isClassModeFirstSeen(e) || isCompleteFilterListing(e)) ?? null;
}

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
  if (e.tool === "atlas_filter" && typeof body.total === "number") {
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

export function auditCompleteness(
  question: string,
  answer: string,
  evidence: CompletenessEvidence[],
): CompletenessAudit {
  if (!questionNeedsClass(question) || !answerAssertsCompleteness(answer)) {
    return { outcome: "noop", detail: "not an exhaustive/extremum assertion" };
  }
  const rows = evidence;
  const ground = classGrounding(rows);
  if (ground) {
    const clash = refuteAgainst(answer, ground);
    if (clash) return { outcome: "refuted", detail: clash };
    return { outcome: "grounded", detail: ground.tool === "atlas_first_seen" ? "class-mode atlas_first_seen" : "untruncated atlas_filter" };
  }
  return { outcome: "unverified", detail: COMPLETENESS_REQUERY_STEER };
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

export interface ToolChoiceCall {
  name: string;
  args: Record<string, unknown>;
  result?: Record<string, unknown>;
}

function isRankedOnly(call: ToolChoiceCall): boolean {
  if (call.name === "atlas_search") return true;
  if (call.name !== "atlas_query") return false;
  const q = call.args.q ?? call.args.search ?? call.args.query;
  if (typeof q !== "string" || !q) return false;
  return !hasClassArgs(call.args) && call.args.target_type == null;
}

function isMembershipCall(call: ToolChoiceCall): boolean {
  return call.name === "atlas_search" || call.name === "atlas_query" || call.name === "atlas_filter" || call.name === "atlas_first_seen";
}

// Eval / bakeoff tool-choice arm: the incident is search-then-ids, not a prose
// miss. Fail if the first class-shaped call is ranked retrieval, or if
// first_seen ran only with search ids. Pass on filter-by-title or class-mode
// first_seen before the answer; a listing used for "all" must not be has_more.
export function scoreCompletenessToolChoice(question: string, calls: ToolChoiceCall[]): { pass: boolean; reason: string } {
  if (!questionNeedsClass(question)) return { pass: true, reason: "not a class question" };
  const membership = calls.filter(isMembershipCall);
  if (membership.length === 0) return { pass: false, reason: "no class listing or first_seen call" };

  const first = membership[0]!;
  if (isRankedOnly(first)) {
    return { pass: false, reason: `first membership call was ${first.name} with ranked q — not a census` };
  }
  if (first.name === "atlas_first_seen" && hasIdsArgs(first.args) && !hasClassArgs(first.args)) {
    return { pass: false, reason: "atlas_first_seen ran in ids mode (search-sized batch), not class mode" };
  }

  const listingQs = /\ball\b|\bevery\b|how many/i.test(question);
  const filter = calls.find((c) => c.name === "atlas_filter");
  const classSeen = calls.find((c) => c.name === "atlas_first_seen" && hasClassArgs(c.args) && !hasIdsArgs(c.args));
  if (listingQs && filter) {
    if (filter.result?.has_more === true || filter.result?.truncated === true) {
      return { pass: false, reason: "atlas_filter listing used for an exhaustive question was incomplete (has_more/truncated)" };
    }
    return { pass: true, reason: "complete atlas_filter listing" };
  }
  if (classSeen) return { pass: true, reason: "class-mode atlas_first_seen" };
  if (filter && filter.result?.has_more !== true && filter.result?.truncated !== true) {
    return { pass: true, reason: "complete atlas_filter listing" };
  }
  if (filter) return { pass: false, reason: "atlas_filter listing was incomplete" };
  return { pass: false, reason: "no complete class listing or class-mode first_seen" };
}
