// The post-answer model lanes — the sliced audit, the Sources-chip marks, the
// answer-coverage judge — and the wire/row shapes each one resolves into.
import type { JsonCall } from "../llm.ts";
import type { Indexes } from "../../retrieval/indexes.ts";
import type { ErrorContext } from "../../posthog-node.ts";
import type { CheckReport } from "../verify/verify-checks.ts";
import type { EvidenceEntry, Verdict, VerifierRun, VerifyOverall } from "../verify/verifier.ts";
import { runSlicedVerifier, sliceModels } from "../verify/sliced-verifier.ts";
import type { ParagraphRefute } from "../verify/paragraph-refute.ts";
import { shownMarks, type runCitationMarks } from "../verify/citation-marks.ts";
import type { judgeAnswerCoverage } from "../verify/answer-coverage.ts";
import type { CheckRowMeta, HarnessEvent } from "./types.ts";

type VerifyResultEvent = Extract<HarnessEvent, { type: "verify_result" }>;
type WireContradiction = VerifyResultEvent["contradictions"][number];

function asWire(c: { answer_span: string; evidence_span: string; why: string; uuid: string | null }): WireContradiction {
  return { answer: c.answer_span, evidence: c.evidence_span, why: c.why, uuid: c.uuid };
}

// Every input to `failed` belongs on the wire — see HarnessEvent's verify_result.
function checkFindings(checks: CheckReport) {
  return {
    invalidCitations: checks.invalidCitations,
    invalidDocNos: checks.invalidDocNos,
    docNoMismatches: checks.docNoMismatches,
    ungroundedQuotes: checks.ungroundedQuotes,
    ungroundedAddresses: checks.ungroundedAddresses,
    ungroundedCitationValues: checks.ungroundedCitationValues,
    paramMismatches: checks.paramMismatches,
    completenessFailures: checks.completenessFailures,
    missingExternalDisclaimer: checks.missingExternalDisclaimer,
    mscCitedAsAtlas: checks.mscCitedAsAtlas,
    lengthCapped: checks.lengthCapped,
  };
}

export function verifyEvent(overall: VerifyOverall, verdict: Verdict | null, checks: CheckReport): VerifyResultEvent {
  const contradictions = verdict?.contradictions ?? [];
  return {
    type: "verify_result",
    overall,
    // Unagreed candidates are dropped here — the confirm gate is hard, so a
    // candidate the second judge did not agree with must never reach the wire.
    contradictions: contradictions.filter((c) => c.agreed).map(asWire),
    rulingIssued: verdict?.ruling_issued ?? false,
    ...checkFindings(checks),
  };
}

export interface AuditParams {
  jsonCall: JsonCall;
  ix: Indexes;
  question: string;
  answer: string;
  evidence: EvidenceEntry[];
  checks: CheckReport;
  signal?: AbortSignal;
  obs?: ErrorContext;
  paragraphRefutes?: ParagraphRefute[];
  settleMs?: number;
}

// One model audit of an answer: two concurrent narrow auditors
// (verify/sliced-verifier.ts) — `refute` (evidence-contradiction) and
// `overreach` (stance) — plus one CONDITIONAL `confirm` call that only runs
// when either produced a candidate. `modelLabel` is what the check row
// records as `model`.
export async function runAudit(params: AuditParams): Promise<{ run: VerifierRun; modelLabel: string }> {
  const models = sliceModels();
  const run = await runSlicedVerifier({
    call: params.jsonCall, models, ix: params.ix, question: params.question, answer: params.answer,
    evidence: params.evidence, checks: params.checks, signal: params.signal, obs: params.obs,
    paragraphRefutes: params.paragraphRefutes, settleMs: params.settleMs,
  });
  return { run, modelLabel: `sliced(${[...new Set(Object.values(models))].join(",")})` };
}

// Resolves the citation-marks promise (or does nothing when the feature is
// off) into the one event and one checksMeta row it can produce, so the
// verifierModel and no-verifierModel paths stay in lockstep on what "no
// marks" vs "nothing was judged" means.
export async function resolveCitationMarks(
  promise: ReturnType<typeof runCitationMarks> | null,
  model: string,
): Promise<{ event: Extract<HarnessEvent, { type: "citation_marks" }> | null; meta: CheckRowMeta | null }> {
  if (!promise) return { event: null, meta: null };
  const run = await promise;
  // The stored row keeps every judgement (`run.judged`). The chip only gets a
  // sure document match or a confirmed contradiction — a weaker mark asserts
  // a confidence the calibration does not support.
  const marks = shownMarks(run.marks);
  const event = Object.keys(marks).length > 0 ? ({ type: "citation_marks" as const, marks }) : null;
  if (run.judged.length === 0) return { event, meta: null };
  // Only the raw judgements are stored: conversations/checks.ts re-folds
  // `judged` through aggregateMarks on read rather than trusting a stored
  // summary, so a stored tally would have no reader and could only ever come
  // to disagree with that fold.
  return {
    event,
    meta: {
      kind: "citation_check", model,
      verdict: { judged: run.judged, confirm: run.confirm },
      overall: null, inputTokens: null, outputTokens: null, generationId: null, latencyMs: run.latencyMs,
    },
  };
}

type CoverageRun = NonNullable<Awaited<ReturnType<typeof judgeAnswerCoverage>>>;

function coverageRow(run: CoverageRun, model: string): CheckRowMeta {
  return {
    kind: "answer_coverage", model: run.rawToolOutput ? null : model,
    // Raw distribution + per-part scores: the thresholds are ours, so a
    // future move needs the distribution, not just the ruling.
    verdict: { verdict: run.verdict, probabilities: run.probabilities, parts: run.parts, missingParts: run.missingParts, rawToolOutput: run.rawToolOutput },
    overall: null, inputTokens: run.usage?.input ?? null, outputTokens: run.usage?.output ?? null,
    generationId: run.generationId, latencyMs: run.latencyMs,
  };
}

// Same contract as resolveCitationMarks: one event + one checksMeta row.
// judgeAnswerCoverage never rejects (fail-open to null), and null means no
// event and no row — nothing was ruled.
export async function resolveAnswerCoverage(
  promise: ReturnType<typeof judgeAnswerCoverage> | null,
  model: string,
): Promise<{ event: Extract<HarnessEvent, { type: "answer_coverage" }> | null; meta: CheckRowMeta | null }> {
  const run = promise ? await promise : null;
  if (!run) return { event: null, meta: null };
  return {
    event: {
      type: "answer_coverage", verdict: run.verdict, missingParts: run.missingParts,
      ...(run.parts.length > 0 ? { parts: run.parts.map((p) => p.text) } : {}),
    },
    meta: coverageRow(run, model),
  };
}
