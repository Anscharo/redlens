// Advisor — the escalation-only recovery planner of the chat reliability
// harness. Never runs on a clean turn; when trouble signals fire (see the
// orchestrator's gate) it reviews question + transcript digest + verdict and
// picks exactly one recovery action. Hard timeout (chatAdvisorTimeoutMs); null
// on any failure — the orchestrator falls back to plain annotation, chat never
// blocks on it.
import { z } from "zod";
import type OpenAI from "openai";
import type { JsonCall } from "./llm.ts";
import type { Verdict } from "./verifier.ts";
import type { RoundTelemetry } from "./round-checks.ts";
import { config } from "./config.ts";

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

const RecoverySchema = z.object({
  action: z.enum(["requery", "rewrite", "decline"]),
  guidance: z.string().default(""),
  calls: z.array(z.object({ name: z.string(), args: z.record(z.unknown()).default({}) })).default([]),
});

export type Recovery = z.infer<typeof RecoverySchema>;

export function parseRecovery(text: string): Recovery | null {
  const stripped = text.replace(/```(?:json)?/g, "").trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = RecoverySchema.safeParse(JSON.parse(stripped.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const ADVISOR_SYSTEM = [
  "You are supervising a governance research assistant whose answer failed a verification audit (verdict below) after the retrieval attempts shown.",
  "Decide the single best recovery:",
  '- "requery" — one more tool round would fill the gap. Name the exact calls in "calls" (tool name + args).',
  '- "rewrite" — the evidence already gathered is sufficient; instruct which claims to remove or correct.',
  '- "decline" — the atlas does not support an answer; instruct an honest decline naming what was checked.',
  "One action. Guidance ≤80 words, concrete and imperative.",
  'Respond with STRICT JSON only: {"action":"requery|rewrite|decline","guidance":"…","calls":[{"name":"atlas_query","args":{}}]}',
].join("\n");

export function buildAdvisorPrompt(params: {
  question: string;
  transcriptDigest: string;
  verdict: Verdict | null;
  telemetry: RoundTelemetry;
}): Msg[] {
  const verdictBlock = params.verdict
    ? JSON.stringify(
        {
          claims: params.verdict.claims.map((c) => ({ claim: c.claim.slice(0, 200), status: c.status })),
          invented_facts: params.verdict.invented_facts,
          ruling_issued: params.verdict.ruling_issued,
          feedback: params.verdict.feedback,
        },
        null,
        1,
      )
    : "(no model verdict — escalated on retrieval trouble / deterministic check failure alone)";
  const telemetryBlock = [
    `rounds=${params.telemetry.rounds} toolCalls=${params.telemetry.toolCalls} empty=${params.telemetry.emptyResults} errors=${params.telemetry.errorResults} repeated=${params.telemetry.repeatedQueries}`,
    ...params.telemetry.notes.slice(0, 8),
  ].join("\n");
  return [
    { role: "system", content: ADVISOR_SYSTEM },
    {
      role: "user",
      content: [
        `## Question\n${params.question}`,
        `## Retrieval attempts (tool → result preview)\n${params.transcriptDigest}`,
        `## Verification verdict\n${verdictBlock}`,
        `## Retrieval telemetry\n${telemetryBlock}`,
      ].join("\n\n"),
    },
  ];
}

export interface AdvisorRun {
  recovery: Recovery | null;
  usage: { input: number; output: number } | null;
  generationId: string | null;
  latencyMs: number | null;
}

export async function adviseRecovery(params: {
  call: JsonCall;
  model: string;
  question: string;
  transcriptDigest: string;
  verdict: Verdict | null;
  telemetry: RoundTelemetry;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<AdvisorRun> {
  const timeoutMs = params.timeoutMs ?? config.chatAdvisorTimeoutMs;
  try {
    const res = await Promise.race([
      params.call({ model: params.model, messages: buildAdvisorPrompt(params), maxTokens: 500, signal: params.signal }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("advisor timeout")), timeoutMs)),
    ]);
    return { recovery: parseRecovery(res.text), usage: res.usage, generationId: res.generationId, latencyMs: res.latencyMs };
  } catch {
    return { recovery: null, usage: null, generationId: null, latencyMs: null };
  }
}
