// The signals the completeness contract (completeness.ts) reads: which questions
// and answers are exhaustive or superlative, and which tool results count as a
// complete class listing.
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

export function parseJson(raw: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const CLASS_ARG_KEYS = ["title", "title_prefix", "type", "doc_no_pattern", "ancestor_id", "entity"] as const;

export function hasClassArgs(args: Record<string, unknown>): boolean {
  return CLASS_ARG_KEYS.some((k) => typeof args[k] === "string" && String(args[k]).length > 0);
}

export function hasIdsArgs(args: Record<string, unknown>): boolean {
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

// atlas_report_* are curated whole-atlas rollups;
// row-list reports share { report, total, returned, truncated, note? } plus one
// named payload array, so an untruncated one is class grounding just like a
// complete atlas_filter listing.
export function isCompleteReportListing(e: CompletenessEvidence): boolean {
  if (!e.tool.startsWith("atlas_report_")) return false;
  const body = parseJson(e.content);
  if (!body || typeof body.total !== "number") return false;
  if (body.truncated === true) return false;
  return true;
}

export function classGrounding(evidence: CompletenessEvidence[]): CompletenessEvidence | null {
  return evidence.find((e) => isClassModeFirstSeen(e) || isCompleteFilterListing(e) || isCompleteReportListing(e)) ?? null;
}
