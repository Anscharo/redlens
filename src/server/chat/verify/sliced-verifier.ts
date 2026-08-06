// Sliced-verifier orchestration: runs the four verifier-slices.ts auditors
// CONCURRENTLY (per-slice models — roles may diverge) and merges their results
// into the single-verifier Verdict shape, so computeOverall, the advisor, the
// badge, and persistence consume it unchanged.
//
// Merge rule mirrors computeOverall's philosophy — severity can be added,
// never removed: a parsed slice's contradiction/ruling always survives, but a
// clean-looking merge with the `claims` backbone missing degrades to null
// (unverified) rather than blessing an answer the main audit never checked.
import { callWithTimeout, type JsonCall } from "../llm.ts";
import { config } from "../../config.ts";
import { captureEvent, type ErrorContext } from "../../posthog-node.ts";
import type { CheckReport } from "./verify-checks.ts";
import type { EvidenceEntry, Verdict, VerifierRun } from "./verifier.ts";
import { runSlice, type SliceName, type SliceResult } from "./verifier-slices.ts";

export const SLICES: SliceName[] = ["claims", "figures", "sets", "overreach"];

// Per-slice model routing: CHAT_VERIFIER_SLICE_MODELS="claims=m1,figures=m2";
// unnamed slices fall back to the shared CHAT_VERIFIER_MODEL slot.
export function sliceModels(): Record<SliceName, string> {
  const overrides = new Map<string, string>();
  for (const pair of config.chatVerifierSliceModels.split(",")) {
    const i = pair.indexOf("=");
    if (i > 0) overrides.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
  const of = (s: SliceName) => overrides.get(s) || config.chatVerifierModel;
  return { claims: of("claims"), figures: of("figures"), sets: of("sets"), overreach: of("overreach") };
}

export function mergeSlices(results: SliceResult[]): Verdict | null {
  const parsed = results.filter((r) => r.parsed);
  if (parsed.length === 0) return null;
  const claims: Verdict["claims"] = parsed
    .filter((r) => r.slice !== "overreach")
    .flatMap((r) =>
      r.claims.map((c) => ({
        claim: c.claim,
        status: c.status,
        evidence: c.span ? [c.span.slice(0, 160)] : [],
        cited_uuid: null,
        note: [r.slice, c.absence ? "absence" : null, c.spanValid === false ? `span-invalid(${(c.spanScore ?? 0).toFixed(2)})` : null]
          .filter(Boolean)
          .join(" · "),
      })),
    );
  const rulingIssued = parsed.find((r) => r.slice === "overreach")?.rulingIssued ?? false;
  const anyBad = rulingIssued || claims.some((c) => c.status !== "supported");
  if (!parsed.some((r) => r.slice === "claims") && !anyBad) return null; // backbone missing + nothing bad ⇒ don't bless
  const spanKilled = claims.filter((c) => c.note?.includes("span-invalid")).length;
  const feedback = [
    ...parsed.filter((r) => r.notes).map((r) => `${r.slice}: ${r.notes}`),
    spanKilled ? `${spanKilled} claim(s) demoted to unsupported: their quoted evidence spans were not found in the evidence.` : "",
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 600);
  return { claims, invented_facts: [], ruling_issued: rulingIssued, confidence: null, feedback };
}

export async function runSlicedVerifier(params: {
  call: JsonCall;
  models: Record<SliceName, string>;
  question: string;
  answer: string;
  evidence: EvidenceEntry[];
  checks: CheckReport;
  signal?: AbortSignal;
  timeoutMs?: number;
  obs?: ErrorContext;
}): Promise<VerifierRun & { slices: SliceResult[] }> {
  const timeoutMs = params.timeoutMs ?? config.chatVerifierSliceTimeoutMs;
  // Same hard-deadline semantics as the single verifier: cancel the provider
  // request on timeout, degrade to unverified — never stall the terminal done.
  const timed: JsonCall = (args) =>
    callWithTimeout(params.call, { model: args.model, messages: args.messages, maxTokens: args.maxTokens }, timeoutMs, params.signal);
  const results = await Promise.all(
    SLICES.map((slice) =>
      runSlice({
        call: timed,
        model: params.models[slice],
        slice,
        question: params.question,
        answer: params.answer,
        evidence: params.evidence,
        worklist: slice === "figures" && params.checks.untracedNumbers.length ? params.checks.untracedNumbers : undefined,
      }),
    ),
  );
  for (const r of results) {
    if (!r.parsed) captureEvent("chat_slice_unparseable", params.obs, { slice: r.slice, model: params.models[r.slice] });
  }
  const used = results.filter((r) => r.usage);
  return {
    verdict: mergeSlices(results),
    usage: used.length
      ? { input: used.reduce((s, r) => s + (r.usage?.input ?? 0), 0), output: used.reduce((s, r) => s + (r.usage?.output ?? 0), 0) }
      : null,
    generationId: null, // four generations; per-slice ids live in `slices`
    latencyMs: results.reduce((m, r) => Math.max(m, r.latencyMs ?? 0), 0) || null,
    slices: results,
  };
}
