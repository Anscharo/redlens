// Jev screen in front of the per-paragraph refute auditor (paragraph-refute.ts,
// CHAT_REFUTE_SCREEN). ONE Jev request per paragraph: the paragraph split into
// statements, one Choice per statement — consistent / contradicted /
// unsupported — over one shared state of narrowed evidence.
//
// It GATES gemma; it never produces a contradiction itself. Jev returns no
// verbatim evidence span for code to re-validate, and the confirm gate needs
// one, so a Jev flag can only ever mean "send this paragraph to the auditor
// that can quote". Measured 2026-09-22 (docs/plans/jev-typesafe.md, research
// round part 3): Jev 0.40 s p50 per paragraph vs gemma 3.8 s p50 with 2 of 10
// spot calls running into the 45 s timeout.
//
// Evidence: every doc the paragraph cites, read in FULL from the atlas index
// (tool results can be excerpts), then tool-output records — cited-matching
// first, then top-8 by overlap (refute-screen-evidence.ts) — then the
// deterministic param-table rows. The schema entry [E0] is left out: it stops
// gemma reading true schema facts (doc counts, type vocabularies) as invented,
// and is pure distraction for a per-statement judgment.
import { askJev, choiceOf, withDeadline, type JevRun } from "../../jev.ts";
import type { Indexes } from "../../retrieval/indexes.ts";
import { captureError, type ErrorContext } from "../../posthog-node.ts";
import type { EvidenceEntry } from "./verifier.ts";
import { claimSegments } from "./verify-checks.ts";
import { tablesAsProse, realWords, MIN_CLAIM_WORDS } from "./cite-pairs.ts";
import { hasGroundableMarker } from "./smalltalk.ts";
import { citedDocs, rankRecords, recordsOf, type EvidenceRecord } from "./refute-screen-evidence.ts";

// P(contradicted) on the paragraph's WORST statement at which gemma is called.
// Measured over 66 stored paragraphs + 100 planted name/number contradictions:
// at 0.2, 85/100 caught (number swaps 61/64, name swaps 24/36) and 60/66 clean
// paragraphs skip gemma — 3 of the 6 "false" flags were real errors in stored
// answers that gemma per paragraph also missed. 0.1 buys 6 more catches for
// 10 more flagged clean paragraphs; 0.3–0.4 lose catches and skip no more.
// In-sample: re-measure with `pnpm eval:refute-screen` before moving it.
export const SCREEN_CONTRADICTED_THRESHOLD = 0.2;
// Jev's context is 32k; 4k of headroom for the estimate's error.
export const SCREEN_MAX_TOKENS = 28_000;
// Measured on billed input: JSON-heavy state ≈ chars / 2.1, and every Choice
// question costs ~311 tokens on its own (criteria + instructions).
export const SCREEN_CHARS_PER_TOKEN = 2.1;
export const SCREEN_TOKENS_PER_QUESTION = 311;
// Caller-owned WALL-CLOCK deadline: askJev's own timeout is per attempt and it
// retries 429/5xx with backoff. Observed max 1.04 s over 239 calls; a miss
// returns null, which every caller treats as "send it to gemma".
export const SCREEN_DEADLINE_MS = 3000;

// Verbatim from the research run — the measured numbers apply to this wording.
export const UNIT_CRITERIA = {
  consistent: "The evidence states what the statement says, or the statement is a faithful paraphrase, summary, or direct consequence of what the evidence states.",
  contradicted: "The evidence states something incompatible with the statement — a different value, number, name, holder, date, status, count, or modality (the evidence says may where the statement says must).",
  unsupported: "The evidence does not state what the statement asserts, so it can neither confirm nor contradict it — including statements about things the evidence never mentions.",
};
export function unitQuestion(unit: string) {
  return {
    type: "choice" as const,
    instructions: `Compare ONE statement from \`paragraph\` against \`evidence\` (records retrieved from the Sky Atlas while writing the answer). The statement:\n"${unit}"\nJudge only this statement; read the rest of \`paragraph\` only to resolve what it refers to.`,
    criteria: UNIT_CRITERIA,
  };
}

const LINK = /\[([^\]\n]{1,120})\]\([^)\s]*\)/g;
/** Statements of a paragraph: tables → labelled prose, then claimSegments; link TEXT kept (it can be the value), URL dropped. */
export function statementsOf(paragraph: string): string[] {
  return claimSegments(tablesAsProse(paragraph))
    .map((s) => s.replace(LINK, "$1").replace(/\*\*|__|`/g, "").replace(/^\s*(?:[-*+]|\d+\.)\s+/, "").replace(/\s+/g, " ").trim())
    .filter((s) => realWords(s) >= MIN_CLAIM_WORDS);
}

export interface ScreenRequest {
  state: { question: string; paragraph: string; evidence: { source: string; record: unknown }[] };
  questions: Record<string, ReturnType<typeof unitQuestion>>;
  statements: string[];
  estTokens: number;
  /** false when the cited docs + param rows alone overflow the budget — never sent. */
  fits: boolean;
  counts: { citedDocs: number; constRecords: number; toolRecords: number; droppedForBudget: number };
}

const parseRec = (t: string): unknown => {
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
};
const toolEntry = (r: EvidenceRecord) => ({ source: `${r.entry} ${r.tool}${r.path === "(header)" ? "" : ` ${r.path}`}`, record: parseRec(r.text) });

/** Pure: the state, the questions, and whether it fits. No network. */
export function buildScreenRequest(p: { question: string; paragraph: string; evidence: EvidenceEntry[]; ix: Indexes }): ScreenRequest {
  const statements = statementsOf(p.paragraph);
  const recs = recordsOf(p.evidence.filter((e) => e.label !== "[E0]"));
  const constRecs = recs.filter((r) => r.entry === "[E-const]");
  const docs = citedDocs(p.paragraph, p.ix).map((d) => ({
    source: `atlas document ${d.doc_no} (cited by the paragraph)`,
    record: { id: d.id, doc_no: d.doc_no, title: d.title, type: d.type, content: d.content },
  }));
  const core = [...docs, ...constRecs.map(toolEntry)];
  const questionTokens = SCREEN_TOKENS_PER_QUESTION * statements.length;
  const budgetChars = (SCREEN_MAX_TOKENS - questionTokens) * SCREEN_CHARS_PER_TOKEN;
  let chars = JSON.stringify({ question: p.question, paragraph: p.paragraph, evidence: core }).length;
  const fits = chars <= budgetChars;
  // Each candidate is built ONCE and carried with its own measured length:
  // the entry used to be built to measure it and then rebuilt for the body,
  // so every kept record paid two JSON.parse and an extra JSON.stringify.
  const kept: { rec: EvidenceRecord; entry: ReturnType<typeof toolEntry> }[] = [];
  let dropped = 0;
  for (const r of rankRecords(p.paragraph, recs, p.ix, 8)) {
    if (r.entry === "[E-const]") continue; // already in the core
    const entry = toolEntry(r);
    const add = JSON.stringify(entry).length + 1;
    if (fits && chars + add <= budgetChars) {
      kept.push({ rec: r, entry });
      chars += add;
    } else dropped++;
  }
  kept.sort((a, b) => a.rec.pos - b.rec.pos);
  return {
    state: { question: p.question, paragraph: p.paragraph, evidence: [...core, ...kept.map((k) => k.entry)] },
    questions: Object.fromEntries(statements.map((s, i) => [`u${i}`, unitQuestion(s)])),
    statements,
    estTokens: Math.ceil(chars / SCREEN_CHARS_PER_TOKEN) + questionTokens,
    fits,
    counts: { citedDocs: docs.length, constRecords: constRecs.length, toolRecords: kept.length, droppedForBudget: dropped },
  };
}

export type ScreenVerdict = "consistent" | "contradicted" | "unsupported";
export interface ScreenResult {
  flagged: boolean;
  /** Max P(contradicted) over the statements. */
  maxContradicted: number;
  statements: { text: string; verdict: ScreenVerdict; p: number }[];
  fits: boolean;
  latencyMs: number;
  estTokens: number;
  inputTokens: number | null;
  costUsd: number | null;
  generationId: string | null;
}

/** THE gate rule: gemma is skipped only on a judged, fitting, non-empty, unflagged screen. */
// A paragraph with no statements is usually a heading or a `---` rule — 9 of
// the 16 paragraphs gate mode still sent to gemma were exactly that, and gemma
// found nothing in any of them (measured 2026-09-23). But "no statements" alone
// is the WRONG test for skipping: statementsOf drops anything under three real
// words, so the terse claim "Threshold: 3 of 5" also has none, and that is
// precisely the shape a number swap hides in. So a paragraph is only skippable
// when it carries nothing checkable at all: no prose once headings and rules
// are stripped, and no figure, link, uuid or doc number anywhere in it.
// The marker half is smalltalk.ts's GROUNDABLE_RES, via hasGroundableMarker —
// the same question ("is there anything here the harness could check?") that
// the small-talk bypass asks of a whole answer. A local four-regex copy lived
// here first and silently dropped four of its classes, so a paragraph whose
// only checkable content was a bare URL or an 0x address skipped the auditor.
export function hasCheckableContent(paragraph: string): boolean {
  const body = paragraph
    .replace(/^\s*#{1,6}\s+.*$/gm, "") // headings
    .replace(/^\s*[-*_]{3,}\s*$/gm, ""); // horizontal rules
  return realWords(body) >= MIN_CLAIM_WORDS || hasGroundableMarker(paragraph);
}

export function needsGemma(s: ScreenResult | null, paragraph: string): boolean {
  if (!s || !s.fits || s.flagged) return true;
  // Nothing the screen could judge: send it to gemma anyway UNLESS there is
  // nothing to check in the first place.
  if (s.statements.length === 0) return hasCheckableContent(paragraph);
  return false;
}

/** A screen that sent nothing: nothing to judge, or too big to send. */
function unsent(req: ScreenRequest): ScreenResult {
  return { flagged: false, maxContradicted: 0, statements: [], fits: req.fits, latencyMs: 0, estTokens: req.estTokens, inputTokens: null, costUsd: null, generationId: null };
}

/** Pure: a Jev run → a result. Any unanswered or malformed statement ⇒ null (the screen cannot vouch). */
export function readScreen(req: ScreenRequest, run: JevRun): ScreenResult | null {
  const statements: ScreenResult["statements"] = [];
  for (let i = 0; i < req.statements.length; i++) {
    const c = choiceOf(run, `u${i}`);
    if (!c || !Object.hasOwn(UNIT_CRITERIA, c.choice)) return null;
    const pc = c.probabilities?.contradicted;
    const p = typeof pc === "number" ? pc : c.choice === "contradicted" ? 1 : 0;
    statements.push({ text: req.statements[i], verdict: c.choice as ScreenVerdict, p });
  }
  const maxContradicted = Math.max(0, ...statements.map((s) => s.p));
  return {
    flagged: maxContradicted >= SCREEN_CONTRADICTED_THRESHOLD, maxContradicted, statements, fits: true,
    latencyMs: run.latencyMs, estTokens: req.estTokens, inputTokens: run.usage?.input ?? null, costUsd: run.cost, generationId: run.generationId,
  };
}

/** One paragraph, one request. Never throws: any failure is null (→ gemma). */
export async function screenParagraph(p: {
  question: string;
  paragraph: string;
  evidence: EvidenceEntry[];
  ix: Indexes;
  obs?: ErrorContext;
  model: string;
  signal?: AbortSignal;
  deadlineMs?: number;
}): Promise<ScreenResult | null> {
  try {
    const req = buildScreenRequest(p);
    if (!req.fits || req.statements.length === 0) return unsent(req);
    const deadlineMs = p.deadlineMs ?? SCREEN_DEADLINE_MS;
    const signal = withDeadline(deadlineMs, p.signal);
    const run = await askJev({ state: req.state, questions: req.questions, model: p.model, signal, timeoutMs: deadlineMs });
    return readScreen(req, run);
  } catch (err) {
    // Reported, then null → gemma runs. Shadow mode is a MEASUREMENT phase, so
    // a screen that silently never answers would quietly read as "Jev agreed
    // with gemma everywhere" in the comparison.
    captureError(err, p.obs, { stage: "refute_screen", model: p.model });
    return null;
  }
}
