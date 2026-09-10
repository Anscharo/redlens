// The confirm gate — a second, cheap judge that must independently agree
// before a code-validated contradiction candidate is allowed to fail a turn.
// Two auditors catching the same thing in two different ways (one narrative,
// one adversarial-checklist) is cheaper insurance than trusting the refute
// slice's own conviction, and it only ever runs when there is at least one
// candidate to look at — the common clean-answer turn never pays for it.
import type OpenAI from "openai";
import type { JsonCall } from "../llm.ts";
import type { Contradiction } from "./verifier.ts";
import { captureEvent, type ErrorContext } from "../../posthog-node.ts";
import { parseJsonish } from "./slice-json.ts";

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

const CONFIRM_PROMPT = [
  "A first auditor flagged statements in an answer as CONTRADICTED by evidence.",
  "For each numbered candidate you see the answer sentence, the evidence sentence, and the auditor's reason.",
  "Agree ONLY when the evidence sentence genuinely states something incompatible with the answer sentence about the same subject.",
  "Do not agree when the two are about different things, when the evidence merely lacks the fact, or when the difference is wording.",
  'Respond with STRICT JSON: {"agree":[1,3],"notes":"≤30 words"}',
].join("\n");

export function buildConfirmPrompt(params: { answer: string; candidates: Contradiction[] }): Msg[] {
  const { answer, candidates } = params;
  const list = candidates
    .map(
      (c, i) =>
        `${i + 1}. Answer: "${c.answer_span}"\n   Evidence: "${c.evidence_span}"\n   Auditor's reason: ${c.why}`,
    )
    .join("\n\n");
  return [
    { role: "system", content: CONFIRM_PROMPT },
    { role: "user", content: [`## Answer\n${answer}`, `## Candidates\n${list}`].join("\n\n") },
  ];
}

export interface ConfirmRun {
  agreed: Set<number>; // 0-based indexes into `candidates`
  parsed: boolean;
  usage: { input: number; output: number } | null;
  latencyMs: number | null;
}

export async function runConfirm(params: {
  call: JsonCall;
  model: string;
  answer: string;
  candidates: Contradiction[];
  signal?: AbortSignal;
  obs?: ErrorContext;
}): Promise<ConfirmRun> {
  try {
    const res = await params.call({
      model: params.model,
      messages: buildConfirmPrompt({ answer: params.answer, candidates: params.candidates }),
      maxTokens: 1000,
      signal: params.signal,
    });
    const j = parseJsonish(res.text);
    const rawAgree = j && Array.isArray(j.agree) ? j.agree : null;
    if (!rawAgree) {
      captureEvent("chat_confirm_unparseable", params.obs, { model: params.model });
      return { agreed: new Set(), parsed: false, usage: res.usage, latencyMs: res.latencyMs };
    }
    const agreed = new Set<number>();
    for (const n of rawAgree) {
      if (typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= params.candidates.length) agreed.add(n - 1);
    }
    return { agreed, parsed: true, usage: res.usage, latencyMs: res.latencyMs };
  } catch {
    // A thrown call (timeout, transport error) degrades the same way as an
    // unparseable response: fail toward silence, never toward a fail badge.
    captureEvent("chat_confirm_unparseable", params.obs, { model: params.model });
    return { agreed: new Set(), parsed: false, usage: null, latencyMs: null };
  }
}
