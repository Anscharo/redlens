// Pure grading logic for the golden-question chatbot eval (Phase 4 of
// docs/plans/chatbot-readiness-remediation-plan.md). No network/DB/Bun-SQL
// dependency — this file is imported by both the live runner
// (scripts/aux/eval-golden.ts) and its unit tests, and runs fine under vitest.
import { CITATION_SRC } from "../../src/server/chat/verify/verify-checks.ts";

export type GoldenOutcome = "answered" | "partial" | "honest_decline" | "hallucinated" | "truncated" | "tool_failure";

export interface GoldenCheck {
  // Case-insensitive substrings; at least one must appear in the answer.
  requireAny?: string[];
  // Case-insensitive substrings; all must appear in the answer.
  requireAll?: string[];
  // Case-insensitive substrings; NONE may appear (hallucination / overclaim / ruling guard).
  forbidAny?: string[];
  // The answer must contain at least one atlas citation link, per the system
  // prompt's `[Title](/atlas/<uuid>)` format.
  requireCitation?: boolean;
  // Tool names the model should have called at least once to answer this
  // well (informational — recorded as a warning, not a hard failure).
  expectToolCalls?: string[];
}

export interface GoldenQuestion {
  id: string;
  category: string;
  query: string;
  // Which readiness-rubric row this maps to (docs/plans/chatbot-readiness-remediation-plan.md §4.2).
  rubricRow:
    | "complete"
    | "interpretation"
    | "silent"
    | "empty_shell"
    | "exceeds_window";
  expectedOutcome: Exclude<GoldenOutcome, "hallucinated" | "truncated" | "tool_failure">;
  check: GoldenCheck;
  notes: string;
}

export interface GoldenToolCall {
  name: string;
  ok: boolean;
  truncated?: boolean;
}

export interface GoldenGradeResult {
  id: string;
  outcome: GoldenOutcome;
  passed: boolean;
  failures: string[];
  warnings: string[];
}

// The system prompt's citation link format, shared with the runtime harness
// (src/server/verify-checks.ts) so grader and live checks can't drift.
const CITATION_RE = new RegExp(CITATION_SRC, "i");

function containsAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n.toLowerCase()));
}
function missingFromAll(haystack: string, needles: string[]): string[] {
  return needles.filter((n) => !haystack.includes(n.toLowerCase()));
}
function presentFromForbid(haystack: string, needles: string[]): string[] {
  return needles.filter((n) => haystack.includes(n.toLowerCase()));
}

/** Grade one golden question's transcript against its rubric. Pure function —
 *  no I/O. `toolCalls` only need `name`/`ok`/`truncated` (the shape
 *  ChatEvent's ToolCallRecord already has). */
export function gradeAnswer(q: GoldenQuestion, answer: string, toolCalls: GoldenToolCall[]): GoldenGradeResult {
  const failures: string[] = [];
  const warnings: string[] = [];
  const lower = answer.toLowerCase();

  if (!answer.trim()) {
    return { id: q.id, outcome: "tool_failure", passed: false, failures: ["empty answer"], warnings: [] };
  }

  if (toolCalls.some((c) => !c.ok)) {
    warnings.push("at least one tool call failed (ok=false)");
  }
  const truncated = toolCalls.some((c) => c.truncated);
  if (truncated) warnings.push("at least one tool result was truncated");

  if (q.check.requireCitation && !CITATION_RE.test(answer)) {
    failures.push("missing an atlas citation link ([Title](/atlas/<uuid>))");
  }
  if (q.check.requireAll?.length) {
    const missing = missingFromAll(lower, q.check.requireAll);
    if (missing.length) failures.push(`missing required phrase(s): ${missing.join(", ")}`);
  }
  if (q.check.requireAny?.length && !containsAny(lower, q.check.requireAny)) {
    failures.push(`none of the expected phrases present: ${q.check.requireAny.join(" | ")}`);
  }
  const forbiddenPresent = q.check.forbidAny?.length ? presentFromForbid(lower, q.check.forbidAny) : [];
  if (forbiddenPresent.length) {
    failures.push(`forbidden phrase(s) present (looks like a ruling / overclaim): ${forbiddenPresent.join(", ")}`);
  }
  if (q.check.expectToolCalls?.length) {
    const called = new Set(toolCalls.map((c) => c.name));
    const missing = q.check.expectToolCalls.filter((t) => !called.has(t));
    if (missing.length) warnings.push(`expected tool(s) not called: ${missing.join(", ")}`);
  }

  const passed = failures.length === 0;
  // forbidAny violations on a decline/ruling-guard question are the
  // hallucination signal the plan's grader vocabulary calls out explicitly.
  let outcome: GoldenOutcome;
  if (passed) {
    outcome = q.expectedOutcome;
  } else if (forbiddenPresent.length) {
    outcome = "hallucinated";
  } else {
    outcome = "partial";
  }

  return { id: q.id, outcome, passed, failures, warnings };
}
