// Sliced verification — two narrow auditors run CONCURRENTLY: `refute` (the
// only slice that reads evidence) lists contradictions between the answer and
// the retrieved evidence (verify/refute.ts), `overreach` reads only the
// answer's STANCE (does it adjudicate? does it present settlement figures as
// Atlas text?). A third role, `confirm` (verify/confirm.ts), is not run
// through this file at all — it only ever looks at the candidates the other
// two slices already produced, so it has no prompt/parse pair here; it exists
// in `SliceName`/`SLICE_NEEDS_EVIDENCE` purely so the shared types stay one
// union instead of two.
//
// STATUS: LIVE since 2026-09-10 — replaces the four-slice "prove every claim
// supported" design (claims/figures/sets/overreach). That design's load-
// bearing idea — SHOW YOUR WORK, a verbatim span re-checked by code — survives
// here in the opposite direction: every contradiction the model asserts must
// carry a span validate/refute.ts re-checks against the evidence, so the
// model cannot assert a contradiction into existence. What changed is the
// competing risk it guards against: not a fabricated SUPPORT claim off
// adjacent scaffold text, but a fabricated CONTRADICTION — the old design's
// false-positive surface (every claim needing proof) is gone by construction,
// because "the evidence doesn't mention it" is no longer flaggable at all.
//
// Keep prompt/evidence conventions in sync with refute.ts/confirm.ts.
// Measured via scripts/eval/eval-verifier-slices.ts.
import type OpenAI from "openai";
import type { JsonCall } from "../llm.ts";
import type { Contradiction, EvidenceEntry } from "./verifier.ts";
import { buildRefutePrompt, parseRefute, validateContradictions, validateNotFound } from "./refute.ts";
import { parseJsonish } from "./slice-json.ts";

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export type SliceName = "refute" | "overreach" | "confirm";

export interface SliceResult {
  slice: SliceName;
  contradictions: Contradiction[];
  notFound: string[];
  discarded: number;
  rulingIssued: boolean;
  notes: string;
  parsed: boolean;
  latencyMs: number | null;
  usage: { input: number; output: number } | null;
}

const JSON_ONLY = "Respond with STRICT JSON only, no prose, no code fences.";

const OVERREACH_PROMPT = [
  "You audit TWO things: (1) does the answer ADJUDICATE rather than report? (2) does it present Soter Labs / Sky Forum settlement figures as Atlas text?",
  "ruling_issued is true only if the answer itself decides an eligibility/payment/dispute outcome ('the applicant is hereby eligible', 'the facilitator must release payment') instead of reporting what the atlas says and leaving the decision open.",
  "ruling_issued is ALSO true if settlement-cycle dollars (workbooks, MSC figures, To Sky / supply kept) are presented as something the Sky Atlas states, or cited as /atlas/<uuid>. Those figures are external (Soter Labs OEA calculations / forum posts), not Atlas.",
  "Recommendations and analysis requested by the user are NOT rulings. Hedged reporting is NOT a ruling. Correctly labeled 'not from the Atlas' settlement figures are NOT a ruling.",
  JSON_ONLY,
  '{"ruling_issued":false,"notes":"quote the adjudicating sentence, or ≤20 words"}',
].join("\n");

// `overreach` needs no evidence at all — it reads the answer's stance, not its
// facts. `confirm` never runs through this file (see header) but needs an
// entry so the Record type stays total over SliceName.
export const SLICE_NEEDS_EVIDENCE: Record<SliceName, boolean> = {
  refute: true,
  overreach: false,
  confirm: false,
};

function buildOverreachPrompt(params: { question: string; answer: string }): Msg[] {
  return [
    { role: "system", content: OVERREACH_PROMPT },
    { role: "user", content: [`## Question\n${params.question}`, `## Answer to audit\n${params.answer}`].join("\n\n") },
  ];
}

export async function runSlice(params: {
  call: JsonCall;
  model: string;
  slice: SliceName;
  question: string;
  answer: string;
  evidence: EvidenceEntry[];
  signal?: AbortSignal;
  maxTokens?: number;
}): Promise<SliceResult> {
  const base: SliceResult = {
    slice: params.slice, contradictions: [], notFound: [], discarded: 0,
    rulingIssued: false, notes: "", parsed: false, latencyMs: null, usage: null,
  };
  // confirm has its own runner (verify/confirm.ts, driven by sliced-verifier.ts
  // once refute/overreach produce candidates) — runSlice never dispatches it.
  if (params.slice === "confirm") return base;
  try {
    if (params.slice === "overreach") {
      const res = await params.call({
        model: params.model, messages: buildOverreachPrompt(params),
        maxTokens: params.maxTokens ?? 1000, signal: params.signal,
      });
      const j = parseJsonish(res.text);
      if (!j) return { ...base, latencyMs: res.latencyMs, usage: res.usage };
      return {
        ...base,
        rulingIssued: j.ruling_issued === true,
        notes: typeof j.notes === "string" ? j.notes : "",
        parsed: true, latencyMs: res.latencyMs, usage: res.usage,
      };
    }
    const res = await params.call({
      model: params.model, messages: buildRefutePrompt(params),
      // Reasoning models spend output budget thinking before the JSON lands —
      // too small a cap silently truncates them into "unparseable".
      maxTokens: params.maxTokens ?? 4000, signal: params.signal,
    });
    const parsed = parseRefute(res.text);
    if (!parsed) return { ...base, latencyMs: res.latencyMs, usage: res.usage };
    const { kept, discarded } = validateContradictions(parsed.contradictions, params.answer, params.evidence);
    return {
      ...base, contradictions: kept, notFound: validateNotFound(parsed.notFound, params.evidence), discarded,
      notes: parsed.notes, parsed: true, latencyMs: res.latencyMs, usage: res.usage,
    };
  } catch {
    return base;
  }
}
