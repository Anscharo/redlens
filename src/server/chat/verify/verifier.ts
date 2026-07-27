// Verifier — the strong-model final claim audit of the chat reliability
// harness. Runs ONCE per turn, after the answer already streamed (stream +
// badge, never gate). Judges the synthesis against the evidence actually
// retrieved this turn; `overall` is computed IN CODE so the model can never
// upgrade a deterministic citation failure. Any transport/parse failure
// degrades to "unverified" — verification flakiness must never break chat.
import { z } from "zod";
import type OpenAI from "openai";
import { callWithTimeout, type JsonCall } from "../llm.ts";
import type { CheckReport } from "./verify-checks.ts";
import type { RoundTelemetry } from "./round-checks.ts";
import { config } from "../../config.ts";
import { captureError, captureEvent, type ErrorContext } from "../../posthog-node.ts";

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

const ClaimSchema = z.object({
  claim: z.string(),
  status: z.enum(["supported", "unsupported", "contradicted"]),
  evidence: z.array(z.string()).default([]),
  cited_uuid: z.string().nullish(),
  note: z.string().nullish(),
});

const VerdictSchema = z.object({
  claims: z.array(ClaimSchema).default([]),
  invented_facts: z.array(z.string()).default([]),
  ruling_issued: z.boolean().default(false),
  confidence: z.number().min(0).max(1).nullable().default(null),
  feedback: z.string().default(""),
});

export type Verdict = z.infer<typeof VerdictSchema>;
export type VerifyOverall = "pass" | "warn" | "fail" | "unverified";

// Tolerant parse: strip code fences, then salvage first-{ to last-}.
export function parseVerdict(text: string): Verdict | null {
  const stripped = text.replace(/```(?:json)?/g, "").trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = VerdictSchema.safeParse(JSON.parse(stripped.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// overall is computed here, not by the model. Deterministic failures are
// un-appealable; the verdict can only add severity, never remove it.
export function computeOverall(checks: CheckReport | null, verdict: Verdict | null): VerifyOverall {
  if (checks?.failed) return "fail";
  if (!verdict) return "unverified";
  const contradicted = verdict.claims.some((c) => c.status === "contradicted");
  if (contradicted || verdict.invented_facts.length > 0 || verdict.ruling_issued) return "fail";
  if (verdict.claims.some((c) => c.status === "unsupported")) return "warn";
  // An empty claim list means the audit produced nothing to check — typically a
  // JSON-mode-degraded `{}` verdict, where the schema defaults claims/invented
  // to []. That is NOT a clean pass: don't bless a substantive answer green when
  // the verifier didn't actually check it. Degrade to unverified (badge hides).
  if (verdict.claims.length === 0) return "unverified";
  return "pass";
}

export interface EvidenceEntry {
  label: string; // [E1], [E2], …
  tool: string;
  args: string;
  content: string;
}

// Pull the turn's tool calls + results out of the loop transcript, labeled
// [E1..En] in chronological order. The char budget is applied NEWEST-first
// (later rounds are usually the refined, relevant retrievals).
export function evidenceFromTranscript(transcript: Msg[], maxChars = config.chatVerifierEvidenceMaxChars): EvidenceEntry[] {
  const callById = new Map<string, { tool: string; args: string }>();
  const entries: EvidenceEntry[] = [];
  for (const m of transcript) {
    if (m.role === "assistant" && Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) {
        if (tc.type === "function") callById.set(tc.id, { tool: tc.function.name, args: tc.function.arguments });
      }
    }
    if (m.role === "tool" && typeof m.content === "string") {
      const call = callById.get(m.tool_call_id) ?? { tool: "unknown", args: "{}" };
      entries.push({ label: `[E${entries.length + 1}]`, tool: call.tool, args: call.args, content: m.content });
    }
  }
  // Budget newest-first: walk from the end, keep entries while they fit; an
  // oversized entry is truncated rather than dropped so its identity survives.
  let remaining = maxChars;
  const kept: EvidenceEntry[] = [];
  for (let i = entries.length - 1; i >= 0; i--) {
    if (remaining <= 0) break;
    const e = entries[i];
    const content = e.content.length > remaining ? `${e.content.slice(0, remaining)}…[truncated]` : e.content;
    remaining -= content.length;
    kept.unshift({ ...e, content });
  }
  return kept;
}

// Assistant answers from EARLIER turns of the conversation, folded into one
// evidence entry. The system prompt tells the model that atlas material already
// in the conversation counts as grounding, so a follow-up ("summarize what you
// just said") legitimately answers with zero this-turn tool calls — without
// this entry the verifier flags every such claim as unsupported.
export function priorTurnsEvidence(transcript: Msg[], maxChars = 8000): EvidenceEntry | null {
  const lastUser = transcript.findLastIndex((m) => m.role === "user");
  const answers = transcript
    .slice(0, Math.max(lastUser, 0))
    .filter((m) => m.role === "assistant" && typeof m.content === "string" && m.content.trim() !== "")
    .map((m) => m.content as string);
  if (answers.length === 0) return null;
  // Newest-first budget, same policy as tool evidence: recent turns matter most.
  let joined = "";
  for (let i = answers.length - 1; i >= 0; i--) {
    const next = answers[i] + (joined ? "\n---\n" + joined : "");
    if (next.length > maxChars) {
      joined = joined || `${answers[i].slice(0, maxChars)}…[truncated]`;
      break;
    }
    joined = next;
  }
  return {
    label: "[E-prev]",
    tool: "conversation",
    args: "(the assistant's own answers from earlier turns of this conversation)",
    content: joined,
  };
}

const VERIFIER_SYSTEM = [
  "You are a strict verification auditor for a governance research assistant answering from the Sky Atlas.",
  "Judge the assistant's answer ONLY against the evidence entries provided. Your own knowledge of Sky, MakerDAO, or governance is irrelevant; if the evidence does not contain a fact, the fact is unsupported even if you believe it is true.",
  "[E-prev], when present, holds the assistant's own answers from earlier turns: claims that restate or summarize them are supported (conversation continuity), but NEW specifics absent from both [E-prev] and the tool evidence are not.",
  "Claims include: numbers, dates, rates, role assignments, responsibilities, document identities and statuses, and existence/absence statements.",
  "Hedged statements ('the atlas does not appear to cover X') are SUPPORTED when the evidence pattern matches the hedge (e.g. searches returned nothing relevant).",
  "'ruling_issued' is true only if the answer itself adjudicates an eligibility/payment/dispute outcome instead of reporting what the atlas says.",
  "Do NOT judge style, tone, or citation formatting — code handles that.",
  "Respond with STRICT JSON only:",
  '{"claims":[{"claim":"…","status":"supported|unsupported|contradicted","evidence":["E2"],"cited_uuid":null,"note":null}],"invented_facts":[],"ruling_issued":false,"confidence":0.0,"feedback":"≤80 words for a recovery advisor"}',
].join("\n");

export function buildVerifierPrompt(params: {
  question: string;
  answer: string;
  evidence: EvidenceEntry[];
  checks: CheckReport;
  telemetry: RoundTelemetry;
}): Msg[] {
  const { question, answer, evidence, checks, telemetry } = params;
  const evidenceBlock = evidence.length
    ? evidence.map((e) => `${e.label} ${e.tool}(${e.args}) →\n${e.content}`).join("\n\n")
    : "(no tools were called this turn — every factual claim is therefore unsupported unless it is a hedge)";
  const telemetryBlock = [
    `rounds=${telemetry.rounds} toolCalls=${telemetry.toolCalls} empty=${telemetry.emptyResults} errors=${telemetry.errorResults} repeated=${telemetry.repeatedQueries}`,
    ...telemetry.notes.slice(0, 8),
  ].join("\n");
  const checksBlock = [
    `citations=${checks.citations.length} invalid_citations=${checks.invalidCitations.join(",") || "none"}`,
    `invalid_doc_numbers=${checks.invalidDocNos.join(",") || "none"} docno_mismatches=${checks.docNoMismatches.join("; ") || "none"}`,
    `uncited_paragraphs=${checks.uncitedParagraphs} ungrounded_quotes=${checks.ungroundedQuotes.length}`,
    `ungrounded_addresses=${checks.ungroundedAddresses.join(",") || "none"}`,
    // Soft: an untraced figure may be computed, unit-converted, or a schema
    // fact from [E0] — judge each against the evidence rather than assuming.
    `numbers_not_found_verbatim_in_evidence=${checks.untracedNumbers.join(",") || "none"}`,
    ...(checks.lengthCapped ? ["answer_length_capped=true — the answer was cut off by the output length limit, it is incomplete"] : []),
  ].join("\n");
  return [
    { role: "system", content: VERIFIER_SYSTEM },
    {
      role: "user",
      content: [
        `## Question\n${question}`,
        `## Assistant's answer\n${answer}`,
        `## Evidence retrieved this turn\n${evidenceBlock}`,
        `## Retrieval telemetry\n${telemetryBlock}`,
        `## Deterministic check results\n${checksBlock}`,
      ].join("\n\n"),
    },
  ];
}

export interface VerifierRun {
  verdict: Verdict | null;
  usage: { input: number; output: number } | null;
  generationId: string | null;
  latencyMs: number | null;
}

export async function runVerifier(params: {
  call: JsonCall;
  model: string;
  question: string;
  answer: string;
  evidence: EvidenceEntry[];
  checks: CheckReport;
  telemetry: RoundTelemetry;
  signal?: AbortSignal;
  timeoutMs?: number;
  obs?: ErrorContext;
}): Promise<VerifierRun> {
  const timeoutMs = params.timeoutMs ?? config.chatVerifierTimeoutMs;
  try {
    // Hard deadline: a hung/slow verifier call must never stall the terminal
    // done event — the answer already streamed. callWithTimeout CANCELS the
    // provider request on timeout (so it stops burning tokens), then rejects →
    // caught below → "unverified" badge, same as any verification flakiness.
    const res = await callWithTimeout(
      params.call,
      { model: params.model, messages: buildVerifierPrompt(params), maxTokens: 2000 },
      timeoutMs,
      params.signal,
    );
    const verdict = parseVerdict(res.text);
    // The call succeeded but the judge's JSON didn't parse — the turn silently
    // degrades to "unverified" with no other record this happened.
    if (!verdict && res.text.trim()) {
      captureEvent("chat_verdict_unparseable", params.obs, { model: params.model, text_preview: res.text.slice(0, 300) });
    }
    return { verdict, usage: res.usage, generationId: res.generationId, latencyMs: res.latencyMs };
  } catch (err) {
    captureError(err, params.obs, { stage: "verifier_call", model: params.model });
    return { verdict: null, usage: null, generationId: null, latencyMs: null };
  }
}
