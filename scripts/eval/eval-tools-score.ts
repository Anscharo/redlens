// Pure scoring for the tool-choice eval (eval-tools.ts). No network, no
// indexes — the runner records what the loop did, this module decides whether
// it was right, so the grading rules are unit-testable on their own
// (eval-tools-score.test.ts).
import type { PageContext } from "../../src/server/chat/system-prompt.ts";

/** In `acceptFirst`: answering with no tool call is ALSO acceptable. */
export const NO_TOOL = "(none)";

export interface ToolCase {
  id: string;
  category: string;
  /** The question. `{doc_no:<uuid>}` / `{title:<uuid>}` are filled from the
   *  served atlas at run time, so a renumbering never stales a case. */
  q: string;
  pageContext?: PageContext;
  /** An atlas node page: the runner builds pageContext from this uuid the way
   *  the client does (path, nodeId, nodeTitle, nodeDocNo). */
  pageNode?: string;
  /** Earlier turns, oldest first. The current question is appended. */
  history?: { role: "user" | "assistant"; content: string }[];
  /** Tools any of which is a correct FIRST call. [] = no tool call is correct;
   *  NO_TOOL alongside names = either is correct. */
  acceptFirst: string[];
  /** Also a correct FIRST call when a document-carrying fact fired this turn
   *  (DOC_FACTS). The facts round is itself a retrieval — its rows carry doc
   *  uuids — so reading one of those docs is the prompt's "atlas_get … use
   *  after a search to read a doc in full", and the facts note says to use
   *  those doc_ids. */
  acceptFirstAfterDocFacts?: string[];
  /** At least one of these must be called somewhere in the turn. */
  acceptAny?: string[];
  /** Must not be called anywhere in the turn. */
  forbid?: string[];
  /** atlas_query params beyond query/k/enrich this question legitimately needs. */
  allowAtlasQueryParams?: string[];
  note: string;
}

export interface ObservedCall {
  name: string;
  args: Record<string, unknown>;
  /** Loop iteration (0-based) the call was made in. */
  round: number;
  ok: boolean;
  empty: boolean;
  /** atlas_query zeroed by its own filter arguments (`filters_applied`). */
  emptyByFilters: boolean;
}

export interface AqExtra {
  /** Params outside the allowed set carrying a value that filters (non-empty
   *  string/array, any number, `true`) — the ones that change the result. */
  effective: string[];
  /** Params outside the allowed set present at all, empty values included. */
  present: string[];
}

export interface RunScore {
  firstCalls: string[];
  firstOk: boolean;
  anyOk: boolean;
  forbiddenCalled: string[];
  /** firstOk && anyOk && nothing forbidden. */
  allOk: boolean;
  toolCalls: number;
  toolErrors: number;
  emptyResults: number;
  emptyByFilters: number;
  aqCalls: number;
  aqExtra: AqExtra[];
}

export const AQ_BASE_ALLOWED = ["query", "q", "k", "enrich"];

/** Facts whose injected rows carry document uuids (checked 2026-09-22):
 *  glossary definitions, role dossiers, entity rows. Censuses inject counts
 *  and the features guide app routes — neither hands the model a doc to read. */
export const DOC_FACTS = ["glossary", "roles", "entities"];

/** What counts as a correct first call for this case on this run. */
export function acceptedFirst(c: ToolCase, facts: string[] = []): string[] {
  const docFact = facts.some((f) => DOC_FACTS.includes(f));
  return docFact && c.acceptFirstAfterDocFacts ? [...c.acceptFirst, ...c.acceptFirstAfterDocFacts] : c.acceptFirst;
}

export function hasEffectiveValue(v: unknown): boolean {
  if (v === null || v === undefined || v === false) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return true; // numbers (incl. 0) and `true`
}

// A param spelled out at its schema default changes nothing (query-schema.ts).
const AQ_DEFAULTS: Record<string, unknown> = { direction: "both" };

export function atlasQueryExtra(args: Record<string, unknown>, allowed: string[] = []): AqExtra {
  const ok = new Set([...AQ_BASE_ALLOWED, ...allowed]);
  const present = Object.keys(args).filter((k) => !ok.has(k)).sort();
  return { present, effective: present.filter((k) => hasEffectiveValue(args[k]) && AQ_DEFAULTS[k] !== args[k]) };
}

// The list-valued keys our tool results page through. A result carrying any of
// them, all empty, and no positive count/total, returned nothing.
const LIST_KEYS = ["results", "rows", "nodes", "addresses", "edges", "changes", "events", "docs", "entities", "items", "by_relationship"];

export function isEmptyResult(content: string): boolean {
  let v: unknown;
  try {
    v = JSON.parse(content);
  } catch {
    return false;
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  if ("error" in o || o.truncated === true) return false;
  if (o.count === 0 || o.total === 0) return true;
  if (typeof o.count === "number" || typeof o.total === "number") return false;
  const lists = LIST_KEYS.filter((k) => k in o).map((k) => o[k]);
  if (lists.length === 0) return false;
  return lists.every((l) => (Array.isArray(l) ? l.length === 0 : !!l && typeof l === "object" && Object.keys(l).length === 0));
}

/** atlas_query's own "your filter arguments emptied this" envelope (query.ts). */
export function emptiedByFilters(content: string): boolean {
  try {
    const o = JSON.parse(content) as Record<string, unknown>;
    return !!o && Array.isArray(o.filters_applied);
  } catch {
    return false;
  }
}

/** Label hygiene: a renamed tool or param must fail loudly, not score silently. */
export function validateCases(cases: ToolCase[], toolNames: Set<string>, aqParams: Set<string>): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const c of cases) {
    if (seen.has(c.id)) problems.push(`${c.id}: duplicate id`);
    seen.add(c.id);
    for (const n of [...c.acceptFirst, ...(c.acceptFirstAfterDocFacts ?? []), ...(c.acceptAny ?? []), ...(c.forbid ?? [])]) {
      if (n !== NO_TOOL && !toolNames.has(n)) problems.push(`${c.id}: unknown tool ${n}`);
    }
    if (c.acceptAny?.includes(NO_TOOL) || c.forbid?.includes(NO_TOOL)) problems.push(`${c.id}: ${NO_TOOL} only belongs in acceptFirst`);
    for (const p of c.allowAtlasQueryParams ?? []) if (!aqParams.has(p)) problems.push(`${c.id}: unknown atlas_query param ${p}`);
    if (c.pageNode && c.pageContext) problems.push(`${c.id}: pageNode and pageContext are exclusive`);
    const forbidden = new Set(c.forbid ?? []);
    for (const n of c.acceptFirst) if (forbidden.has(n)) problems.push(`${c.id}: ${n} is both accepted and forbidden`);
  }
  return problems;
}

/** `facts` = the fact ids that fired on this run (RunRecord.facts). */
export function scoreRun(c: ToolCase, calls: ObservedCall[], facts: string[] = []): RunScore {
  const firstRound = calls.length ? Math.min(...calls.map((x) => x.round)) : -1;
  const firstCalls = [...new Set(calls.filter((x) => x.round === firstRound).map((x) => x.name))];
  const accept = acceptedFirst(c, facts);
  const noToolOk = accept.length === 0 || accept.includes(NO_TOOL);
  const firstOk = calls.length === 0 ? noToolOk : firstCalls.some((n) => accept.includes(n));
  const called = new Set(calls.map((x) => x.name));
  const anyOk = !c.acceptAny?.length || c.acceptAny.some((n) => called.has(n));
  const forbiddenCalled = (c.forbid ?? []).filter((n) => called.has(n));
  const aq = calls.filter((x) => x.name === "atlas_query");
  return {
    firstCalls,
    firstOk,
    anyOk,
    forbiddenCalled,
    allOk: firstOk && anyOk && forbiddenCalled.length === 0,
    toolCalls: calls.length,
    toolErrors: calls.filter((x) => !x.ok).length,
    emptyResults: calls.filter((x) => x.empty).length,
    emptyByFilters: calls.filter((x) => x.emptyByFilters).length,
    aqCalls: aq.length,
    aqExtra: aq.map((x) => atlasQueryExtra(x.args, c.allowAtlasQueryParams)),
  };
}

/** Two-sided exact sign test over discordant pairs (McNemar, exact form):
 *  b pairs went A-pass/B-fail, c the reverse. p = 2·P(Bin(b+c, ½) ≤ min(b,c)). */
export function signTestP(b: number, c: number): number {
  const n = b + c;
  if (n === 0) return 1;
  const k = Math.min(b, c);
  let tail = 0;
  let coef = 1; // C(n, 0)
  for (let i = 0; i <= k; i++) {
    tail += coef;
    coef = (coef * (n - i)) / (i + 1);
  }
  return Math.min(1, (2 * tail) / 2 ** n);
}
