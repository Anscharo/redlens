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
import type { Indexes } from "../../retrieval/indexes.ts";
import type { CheckReport } from "./verify-checks.ts";
import type { EvidenceEntry, Verdict, VerifierRun } from "./verifier.ts";
import { runSlice, type SliceName, type SliceResult } from "./verifier-slices.ts";
import { auditAbsenceClaim, type AbsenceEvidence } from "./absence.ts";

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

// Absence contract, applied inline while flattening slice claims into the
// Verdict shape (docs/research/synlang-wiki.md §3.1, verify/absence.ts): a
// claim marked `absence: true` and `supported` by its slice no longer gets a
// free pass — it is checked against the parameter table and the turn's raw
// evidence. Only `absence && supported` claims are touched; contradicted/
// unsupported absence claims (the model already flagged trouble) pass through
// untouched, and non-absence claims are never in scope.
function auditedClaim(
  c: SliceResult["claims"][number],
  ix: Indexes,
  evidence: AbsenceEvidence[],
): { status: SliceResult["claims"][number]["status"]; note: string | null } {
  if (!c.absence || c.status !== "supported") return { status: c.status, note: null };
  const audit = auditAbsenceClaim(c.claim, evidence, ix);
  if (audit.outcome === "refuted") return { status: "contradicted", note: `absence-refuted: ${audit.detail}` };
  if (audit.outcome === "unverified") return { status: "unsupported", note: "absence-unverified" };
  return { status: c.status, note: `absence-grounded(${audit.detail.replace(/^grounded:\s*/, "")})` };
}

// `evidence` carries each entry's originating call args, not just its text —
// absence.ts scopes a claim to the evidence about it, and an empty search
// envelope's only record of what was searched for is the query.
export function mergeSlices(results: SliceResult[], ix: Indexes, evidence: AbsenceEvidence[]): Verdict | null {
  const parsed = results.filter((r) => r.parsed);
  if (parsed.length === 0) return null;
  let absenceRefuted = 0;
  let absenceUnverified = 0;
  let firstRefutedDetail = "";
  const claims: Verdict["claims"] = parsed
    .filter((r) => r.slice !== "overreach")
    .flatMap((r) =>
      r.claims.map((c) => {
        const audited = auditedClaim(c, ix, evidence);
        if (audited.note?.startsWith("absence-refuted: ")) {
          absenceRefuted++;
          firstRefutedDetail ||= audited.note.slice("absence-refuted: ".length);
        } else if (audited.note === "absence-unverified") {
          absenceUnverified++;
        }
        return {
          claim: c.claim,
          status: audited.status,
          evidence: c.span ? [c.span.slice(0, 160)] : [],
          cited_uuid: null,
          reference: c.referenceGrounded === true,
          note: [
            r.slice,
            c.absence ? "absence" : null,
            c.referenceGrounded ? "reference" : null,
            c.spanValid === false ? `span-invalid(${(c.spanScore ?? 0).toFixed(2)})` : null,
            audited.note,
          ]
            .filter(Boolean)
            .join(" · "),
        };
      }),
    );
  const rulingIssued = parsed.find((r) => r.slice === "overreach")?.rulingIssued ?? false;
  const anyBad = rulingIssued || claims.some((c) => c.status !== "supported");
  if (!parsed.some((r) => r.slice === "claims") && !anyBad) return null; // backbone missing + nothing bad ⇒ don't bless
  const spanKilled = claims.filter((c) => c.note?.includes("span-invalid")).length;
  const feedback = [
    ...parsed.filter((r) => r.notes).map((r) => `${r.slice}: ${r.notes}`),
    spanKilled ? `${spanKilled} claim(s) demoted to unsupported: their quoted evidence spans were not found in the evidence.` : "",
    absenceRefuted
      ? `${absenceRefuted} absence claim${absenceRefuted === 1 ? "" : "s"} refuted by the parameter table (${firstRefutedDetail}) — the answer must state the real value.`
      : "",
    absenceUnverified
      ? `${absenceUnverified} absence claim${absenceUnverified === 1 ? "" : "s"} unverified — requery (atlas_params or atlas_search) to confirm the gap before asserting it.`
      : "",
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 600);
  return { claims, invented_facts: [], ruling_issued: rulingIssued, confidence: null, feedback };
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
    verdict: mergeSlices(results, params.ix, params.evidence),
    usage: used.length
      ? { input: used.reduce((s, r) => s + (r.usage?.input ?? 0), 0), output: used.reduce((s, r) => s + (r.usage?.output ?? 0), 0) }
      : null,
    generationId: null, // four generations; per-slice ids live in `slices`
    latencyMs: results.reduce((m, r) => Math.max(m, r.latencyMs ?? 0), 0) || null,
    slices: results,
  };
}
