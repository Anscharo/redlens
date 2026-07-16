// Sliced verification — four narrow auditors run CONCURRENTLY instead of one
// prompt doing everything. Motivated by measurement, not taste:
//
//   fabrication 1.00 · ruling 1.00   ← the single verifier already maxes these
//   wrong_doc 0.26-0.39 · number 0.44-0.63  ← broken in every model tested
//   structural misreads               ← 100% missed (the 2026-07-15 audit)
//
// So the slices sit on the FAULT LINES, not on the existing taxonomy.
//
// The load-bearing idea is not the slicing — it is SHOW YOUR WORK. The single
// verifier passed a real defect by asserting `"Spark is a Pioneer" [supported]`
// because the evidence superficially contained scaffold-hub boilerplate
// ("...all data for Spark's Instances of the Pioneer Chain Primitive"). It
// pattern-matched adjacent text into support. Here every `supported` verdict
// must carry a VERBATIM span, and `validateSpans` re-checks that span against
// the evidence in code: a span that isn't really there downgrades the claim to
// unsupported. The model cannot assert support into existence.
import type OpenAI from "openai";
import type { JsonCall } from "./llm.ts";
import type { EvidenceEntry } from "./verifier.ts";
import { normalizeForMatch } from "./verify-checks.ts";

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export type SliceName = "claims" | "figures" | "sets" | "overreach";

export interface SliceClaim {
  claim: string;
  status: "supported" | "unsupported" | "contradicted";
  span: string; // verbatim evidence text — code-validated
  // An ABSENCE claim ("the atlas does not specify which chains") is supported
  // by evidence NOT containing something — there is no span to quote, by
  // construction. Demanding one punishes the single most valuable behaviour we
  // have: admitting a gap. Exempt from span validation.
  absence?: boolean;
  spanValid?: boolean; // set by validateSpans; false ⇒ status forced to unsupported
  spanScore?: number; // best token-overlap achieved against the evidence
}

export interface SliceResult {
  slice: SliceName;
  claims: SliceClaim[];
  rulingIssued: boolean;
  notes: string;
  parsed: boolean;
  latencyMs: number | null;
  usage: { input: number; output: number } | null;
}

const JSON_ONLY = 'Respond with STRICT JSON only, no prose, no code fences.';

// Every slice shares one rule: a claim is supported ONLY if you can quote the
// evidence verbatim. Paraphrase is not support; adjacent text is not support.
const SPAN_RULE = [
  "A claim is `supported` ONLY if you can copy an EXACT, VERBATIM substring of the evidence that establishes it, into `span`.",
  "Copy characters exactly — do not paraphrase, summarise, correct, or shorten with ellipses. Your span is re-checked against the evidence by code; an inexact span is treated as NO support.",
  "Text that is merely ADJACENT or topically similar is not support. Scaffolding/boilerplate ('the documents herein contain all data for X's instances of Y') does NOT establish that X has a Y — it only describes a container.",
  "If no exact span establishes the claim, mark it `unsupported` and set span to \"\". If the evidence states the opposite, mark it `contradicted`.",
  "EXCEPTION — absence claims: if the claim is that the atlas does NOT contain/specify something, no span can exist. Mark it `supported` with span \"\" and set \"absence\":true, when the evidence is consistent with the gap (searches returned nothing relevant). Admitting a gap is correct behaviour, not a failure.",
].join(" ");

const PROMPTS: Record<SliceName, string> = {
  claims: [
    "You audit ONE thing: whether each factual claim in the answer is established by the retrieved evidence.",
    SPAN_RULE,
    "List each distinct factual claim (roles, responsibilities, statuses, existence, relationships). Ignore style and citation formatting.",
    JSON_ONLY,
    '{"claims":[{"claim":"…","status":"supported|unsupported|contradicted","span":"exact evidence substring or empty","absence":false}],"notes":"≤30 words"}',
  ].join("\n"),
  figures: [
    "You audit ONE thing: every NUMBER, RATE, DATE and AMOUNT in the answer.",
    "For each figure decide: `supported` if it appears verbatim in the evidence (put that exact substring in span); `supported` ALSO if it is correctly DERIVED from evidence figures — then put the arithmetic in span (e.g. '0.2% + 0.3% = 0.5%') and cite both source numbers; otherwise `unsupported`.",
    "A figure that is neither in the evidence nor derivable from it is `unsupported`, even if it sounds plausible.",
    JSON_ONLY,
    '{"claims":[{"claim":"the figure and what it describes","status":"supported|unsupported|contradicted","span":"exact substring or arithmetic"}],"notes":"≤30 words"}',
  ].join("\n"),
  sets: [
    "You audit ONE thing: ENUMERATIONS — every list, set, or 'the following X' in the answer.",
    "For EACH listed member, is that member's inclusion established by an exact evidence span? Use one claim entry per member, phrased '<member> belongs to <set>'.",
    SPAN_RULE,
    "Then check COMPLETENESS: if the evidence shows a member the answer omitted, add a `contradicted` entry phrased 'the list omits <member>' with the span proving it belongs.",
    "Beware containers: a document existing FOR an entity does not mean the entity has the thing the document would hold.",
    JSON_ONLY,
    '{"claims":[{"claim":"…","status":"supported|unsupported|contradicted","span":"exact evidence substring or empty","absence":false}],"notes":"≤30 words"}',
  ].join("\n"),
  overreach: [
    "You audit ONE thing: does the answer ADJUDICATE rather than report?",
    "ruling_issued is true only if the answer itself decides an eligibility/payment/dispute outcome ('the applicant is hereby eligible', 'the facilitator must release payment') instead of reporting what the atlas says and leaving the decision open.",
    "Recommendations and analysis requested by the user are NOT rulings. Hedged reporting is NOT a ruling.",
    JSON_ONLY,
    '{"ruling_issued":false,"claims":[],"notes":"quote the adjudicating sentence, or ≤20 words"}',
  ].join("\n"),
};

// `overreach` needs no evidence at all — it reads the answer's stance, not its
// facts. That makes it ~10x cheaper and faster than the others.
export const SLICE_NEEDS_EVIDENCE: Record<SliceName, boolean> = {
  claims: true, figures: true, sets: true, overreach: false,
};

export function buildSlicePrompt(slice: SliceName, params: { question: string; answer: string; evidence: EvidenceEntry[]; worklist?: string[] }): Msg[] {
  const parts = [`## Question\n${params.question}`, `## Answer to audit\n${params.answer}`];
  if (SLICE_NEEDS_EVIDENCE[slice]) {
    parts.push(
      `## Evidence retrieved this turn\n${
        params.evidence.length
          ? params.evidence.map((e) => `${e.label} ${e.tool}(${e.args}) →\n${e.content}`).join("\n\n")
          : "(no tools were called — nothing is supported)"
      }`,
    );
  }
  if (params.worklist?.length) {
    parts.push(`## Code already found these NOT verbatim in the evidence — decide derived vs invented for each\n${params.worklist.join(", ")}`);
  }
  return [
    { role: "system", content: PROMPTS[slice] },
    { role: "user", content: parts.join("\n\n") },
  ];
}

export function parseSlice(text: string): { claims: SliceClaim[]; rulingIssued: boolean; notes: string } | null {
  const stripped = text.replace(/```(?:json)?/g, "").trim();
  const s = stripped.indexOf("{");
  const e = stripped.lastIndexOf("}");
  if (s === -1 || e <= s) return null;
  try {
    const j = JSON.parse(stripped.slice(s, e + 1)) as Record<string, unknown>;
    const raw = Array.isArray(j.claims) ? j.claims : [];
    const claims: SliceClaim[] = raw.flatMap((c) => {
      const o = c as Record<string, unknown>;
      if (typeof o?.claim !== "string") return [];
      const status = o.status === "contradicted" ? "contradicted" : o.status === "supported" ? "supported" : "unsupported";
      return [{ claim: o.claim, status, span: typeof o.span === "string" ? o.span : "", absence: o.absence === true }];
    });
    return { claims, rulingIssued: j.ruling_issued === true, notes: typeof j.notes === "string" ? j.notes : "" };
  } catch {
    return null;
  }
}

// Best token-overlap between the span and ANY window of the evidence.
// Exact containment is the wrong bar: the 2026-07-15 slice grid measured
// spanKill of 22-56 for gemma/haiku, driving their false-positive rate to
// 50-75% — the check was grading TRANSCRIPTION, not judgment. Only a reasoning
// model could copy 50+ chars verbatim (gpt-5-mini spanKill 0 → FPR 0%). This
// codebase already knew that: citation-repair.ts exists because models cannot
// transcribe even a 36-char uuid. So: repair, don't reject.
//
// Locality is what keeps this honest — a bag-of-words check over the whole
// evidence would pass any span built from topical words. Sliding a window the
// span's own size means the words must appear TOGETHER, so the pioneers span
// ("Spark has an active Pioneer Chain instance") still scores ~0.3 against
// scaffold text ("...data and specifications for Spark's Instances of the
// Pioneer Chain Primitive") and is still rejected.
// Word-ish tokens: punctuation dropped (`primitive.}` and `primitive` are the
// same word), figures kept whole (`0.2%`), and a naive plural strip so
// `sparks`/`spark` and `specifications`/`specification` match. Applied
// identically to both sides, so the stemming only has to be consistent, not
// linguistically correct. Short words are left alone (`is`, `has`, `as`).
export function tokenize(s: string): string[] {
  return (s.match(/[a-z0-9]+(?:\.[0-9]+)?%?/g) ?? []).map((t) => (t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t));
}

export function spanOverlap(span: string, hay: string): number {
  const s = tokenize(span);
  const h = tokenize(hay);
  if (!s.length || !h.length) return 0;
  const need = new Map<string, number>();
  for (const t of s) need.set(t, (need.get(t) ?? 0) + 1);
  // Window slightly larger than the span so an elision or inserted word does
  // not push a genuine quote out of frame.
  const size = Math.min(h.length, s.length + Math.ceil(s.length * 0.25) + 1);
  const win = new Map<string, number>();
  let matched = 0;
  let best = 0;
  const add = (t: string) => {
    const cur = win.get(t) ?? 0;
    win.set(t, cur + 1);
    if (cur < (need.get(t) ?? 0)) matched++;
  };
  const rm = (t: string) => {
    const cur = win.get(t) ?? 0;
    win.set(t, cur - 1);
    if (cur <= (need.get(t) ?? 0)) matched--;
  };
  for (let i = 0; i < h.length; i++) {
    add(h[i]);
    if (i >= size) rm(h[i - size]);
    if (i >= size - 1) best = Math.max(best, matched / s.length);
  }
  return best;
}

export const SPAN_MATCH_THRESHOLD = 0.8;

// THE BACKSTOP. A `supported` verdict is only honoured when its span really
// points at evidence — fuzzily, so imperfect copying doesn't kill valid
// support, but locally, so a span assembled from scattered topical words
// cannot buy support. The model still may not assert support into existence;
// it just no longer has to be a photocopier.
export function validateSpans(claims: SliceClaim[], evidenceTexts: string[], threshold = SPAN_MATCH_THRESHOLD): SliceClaim[] {
  const haystacks = evidenceTexts.map(normalizeForMatch);
  return claims.map((c) => {
    if (c.status !== "supported") return { ...c, spanValid: true };
    // Absence is established by evidence NOT containing something — there is
    // nothing to quote, so requiring a span would punish honest gap-admission.
    if (c.absence) return { ...c, spanValid: true };
    const span = normalizeForMatch(c.span ?? "");
    // Derivation spans (arithmetic shown by the `figures` slice) are not
    // quotations — they carry an operator and are judged on their own terms.
    const isDerivation = /[+\-×*/=]/.test(c.span ?? "") && /\d/.test(c.span ?? "");
    if (span.length < 8) return { ...c, status: "unsupported", spanValid: false, spanScore: 0 };
    if (isDerivation) return { ...c, spanValid: true };
    let best = 0;
    for (const h of haystacks) {
      if (h.includes(span)) { best = 1; break; } // exact — fast path
      best = Math.max(best, spanOverlap(span, h));
    }
    const ok = best >= threshold;
    return ok ? { ...c, spanValid: true, spanScore: best } : { ...c, status: "unsupported", spanValid: false, spanScore: best };
  });
}

export async function runSlice(params: {
  call: JsonCall;
  model: string;
  slice: SliceName;
  question: string;
  answer: string;
  evidence: EvidenceEntry[];
  worklist?: string[];
  signal?: AbortSignal;
  maxTokens?: number;
}): Promise<SliceResult> {
  const base: SliceResult = { slice: params.slice, claims: [], rulingIssued: false, notes: "", parsed: false, latencyMs: null, usage: null };
  try {
    const res = await params.call({
      model: params.model,
      messages: buildSlicePrompt(params.slice, params),
      // Reasoning models spend output budget thinking before the JSON lands —
      // too small a cap silently truncates them into "unparseable" (this is
      // exactly what made gpt-5-mini look useless at 2000).
      maxTokens: params.maxTokens ?? 4000,
      signal: params.signal,
    });
    const parsed = parseSlice(res.text);
    if (!parsed) return { ...base, latencyMs: res.latencyMs, usage: res.usage };
    const claims = SLICE_NEEDS_EVIDENCE[params.slice]
      ? validateSpans(parsed.claims, params.evidence.map((e) => e.content))
      : parsed.claims;
    return { ...base, claims, rulingIssued: parsed.rulingIssued, notes: parsed.notes, parsed: true, latencyMs: res.latencyMs, usage: res.usage };
  } catch {
    return base;
  }
}
