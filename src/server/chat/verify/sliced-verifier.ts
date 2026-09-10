// Sliced-verifier orchestration: runs the two verifier-slices.ts auditors
// (`refute`, `overreach`) CONCURRENTLY, then — only if either one produced a
// candidate — runs ONE conditional `confirm` call (verify/confirm.ts) to
// independently agree or disagree with each. Two concurrent auditors plus one
// conditional confirm, never four: the clean-answer turn (the overwhelming
// majority) pays for exactly two calls.
//
// The Verdict is annotate-only: `computeOverall` (verifier.ts) reads it in
// code, so the model can never upgrade its own finding into a worse badge
// than the confirm gate agreed to, or a better one than the deterministic
// checks allow.
import { callWithTimeout, type JsonCall } from "../llm.ts";
import { config } from "../../config.ts";
import { captureEvent, type ErrorContext } from "../../posthog-node.ts";
import type { Indexes } from "../../retrieval/indexes.ts";
import type { CheckReport } from "./verify-checks.ts";
import type { Contradiction, EvidenceEntry, Verdict, VerifierRun } from "./verifier.ts";
import { runSlice, type SliceName, type SliceResult } from "./verifier-slices.ts";
import { runConfirm } from "./confirm.ts";
import { refuteAbsenceSentences } from "./absence.ts";

export const SLICES: SliceName[] = ["refute", "overreach"];

// Per-slice model routing: CHAT_VERIFIER_SLICE_MODELS="refute=m1,confirm=m2";
// unnamed slices fall back to the shared CHAT_VERIFIER_MODEL slot. `confirm`
// is not in SLICES (it isn't run through verifier-slices.ts's runSlice) but
// still gets a routed model here, since sliceModels() is the one place both
// production and the confirm call itself read from.
export function sliceModels(): Record<SliceName, string> {
  const overrides = new Map<string, string>();
  for (const pair of config.chatVerifierSliceModels.split(",")) {
    const i = pair.indexOf("=");
    if (i > 0) overrides.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
  const of = (s: SliceName) => overrides.get(s) || config.chatVerifierModel;
  return { refute: of("refute"), overreach: of("overreach"), confirm: of("confirm") };
}

export async function runSlicedVerifier(params: {
  call: JsonCall;
  models: Record<SliceName, string>;
  ix: Indexes;
  question: string;
  answer: string;
  evidence: EvidenceEntry[];
  checks: CheckReport;
  signal?: AbortSignal;
  timeoutMs?: number;
  obs?: ErrorContext;
}): Promise<VerifierRun & { slices: SliceResult[] }> {
  const timeoutMs = params.timeoutMs ?? config.chatVerifierSliceTimeoutMs;
  // Same hard-deadline semantics as every harness call: cancel the provider
  // request on timeout, degrade toward silence — never stall the terminal done.
  const timed: JsonCall = (args) =>
    callWithTimeout(params.call, { model: args.model, messages: args.messages, maxTokens: args.maxTokens }, timeoutMs, params.signal);

  const results = await Promise.all(
    SLICES.map((slice) =>
      runSlice({
        call: timed, model: params.models[slice], slice,
        question: params.question, answer: params.answer, evidence: params.evidence,
      }),
    ),
  );
  for (const r of results) {
    if (!r.parsed) captureEvent("chat_slice_unparseable", params.obs, { slice: r.slice, model: params.models[r.slice] });
  }

  const refuteResult = results.find((r) => r.slice === "refute")!;
  const overreachResult = results.find((r) => r.slice === "overreach")!;

  // Two sources of candidate, both already code-validated on their own terms
  // (refute.ts's validateContradictions; the owner-token bar in absence.ts):
  // the model's own finding, and a deterministic parameter-table refutation
  // of an absence sentence the model never had to flag itself.
  const candidates: Contradiction[] = [...refuteResult.contradictions, ...refuteAbsenceSentences(params.answer, params.ix)];

  // The confirm gate is CONDITIONAL — it costs a call only when there is
  // something to look at, so the common clean turn never pays for it.
  const confirmModel = params.models.confirm;
  const confirmRun = candidates.length > 0
    ? await runConfirm({ call: timed, model: confirmModel, answer: params.answer, candidates, signal: params.signal, obs: params.obs })
    : null;
  if (confirmRun) {
    for (const i of confirmRun.agreed) candidates[i] = { ...candidates[i], agreed: true };
  }

  // A parsed backbone from EITHER slice is enough to produce a verdict — only
  // total silence (neither parsed) degrades to null/unverified.
  const verdict: Verdict | null = results.some((r) => r.parsed)
    ? {
        contradictions: candidates,
        not_found: refuteResult.notFound,
        ruling_issued: overreachResult.rulingIssued,
        notes: buildNotes(results, results.reduce((s, r) => s + r.discarded, 0)),
        refuteParsed: refuteResult.parsed,
        confirm: confirmRun
          ? { ran: true, model: confirmModel, candidates: candidates.length, agreed: confirmRun.agreed.size }
          : null,
      }
    : null;

  const usages = [...results.map((r) => r.usage), confirmRun?.usage ?? null].filter((u): u is { input: number; output: number } => u !== null);
  // Wall-clock, not a sum: the two slices overlap, and confirm runs AFTER them.
  const latencyMs = (Math.max(...results.map((r) => r.latencyMs ?? 0)) + (confirmRun?.latencyMs ?? 0)) || null;

  return {
    verdict,
    usage: usages.length
      ? { input: usages.reduce((s, u) => s + u.input, 0), output: usages.reduce((s, u) => s + u.output, 0) }
      : null,
    generationId: null, // multiple generations; per-slice ids live in `slices`
    latencyMs,
    slices: results,
  };
}

function buildNotes(results: SliceResult[], discardedTotal: number): string {
  return [
    ...results.filter((r) => r.notes).map((r) => `${r.slice}: ${r.notes}`),
    discardedTotal ? `${discardedTotal} candidate(s) discarded: span not found` : "",
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 600);
}
