import { callWithTimeout, type JsonCall } from "../llm.ts";
import { captureError, captureEvent, type ErrorContext } from "../../posthog-node.ts";

// The deterministic half of the small-talk bypass (chat-orchestrator.ts).
// The MODEL judges whether a message needed the atlas — the system prompt
// tells it plain conversation gets a brief, tool-free reply, and the router
// never makes pre-flight model calls — so the only safe code-side question
// is: does the answer it wrote contain anything the harness could check?
// Any groundable marker (doc numbers, links — markdown or bare autolink —
// reference labels, addresses, or any figure at all) fails the test and
// keeps the full audit: a zero-tool answer that cites or quantifies is
// exactly the hallucination case the verifier exists for. Erring toward
// auditing costs seconds; erring toward bypassing costs trust — so every
// pattern here is loose.
const GROUNDABLE_RES: RegExp[] = [
  /\b[A-Z]{1,3}(?:\.\d+)+\b/, // doc_no shape (signal only — never a lookup key)
  /[0-9a-f]{8}-[0-9a-f]{4}/i, // uuid fragment
  /\/atlas\//, // in-app atlas link
  /\]\(/, // any markdown link
  /\bhttps?:\/\/[^\s)]+/i, // bare autolink — `](` misses https://sky.money with no digits
  /\[[^\]\s]+\]/, // reference-style citation label
  /0x[0-9a-fA-F]{4,}/, // evm address-ish
  /\d/, // any figure — numbers are the verifier's business
  /[{}`]/, // braces/backticks — leaked entity slugs and code spans get repaired, not bypassed
];

// Small talk is short. A reply this long is explaining something, and
// explanations get audited.
export const SMALLTALK_MAX_CHARS = 600;

export function isUncheckableAnswer(content: string): boolean {
  if (content.length > SMALLTALK_MAX_CHARS) return false;
  return !GROUNDABLE_RES.some((re) => re.test(content));
}

// ── Question-side judge — the LLM half, and the final gate ────────────────
// The deterministic predicate above cannot tell "thanks!" from "is the fee
// governance-controlled?" answered with a marker-free "Yes." — a question can
// expect facts without the answer showing any. So the bypass's last condition
// is one tiny classification call on the USER MESSAGE: does it expect factual
// content? Fail-closed everywhere: timeout, error, or unparseable JSON all
// return smalltalk:false, which keeps the full audit. The orchestrator fires
// it CONCURRENTLY with the conversationalist (first user message of a
// conversation only, and only when the message itself is marker-free), so the
// ruling has resolved before the answer finishes streaming — it replaces the
// four verifier slices on greeting turns and blocks nothing. Never rejects,
// so an unconsumed promise is safe to abandon.
export interface SmalltalkJudgeRun {
  smalltalk: boolean;
  usage: { input: number; output: number } | null;
  generationId: string | null;
  latencyMs: number | null;
}

// The `{"smalltalk"` literal doubles as the call's dispatch signature in the
// orchestrator tests (content dispatch, like the verifier slices) — reword
// with care.
const JUDGE_PROMPT = [
  "You classify ONE user message from a governance research chat.",
  'Reply with ONLY this JSON: {"smalltalk": true} or {"smalltalk": false}.',
  'smalltalk=true ONLY for pure conversation whose reply needs no factual content: a greeting, thanks, a farewell, a courtesy, an emoji, a connectivity test ("are you there?").',
  'smalltalk=false for EVERYTHING else — anything that expects facts, definitions, numbers, procedures, opinions, or any information about the Sky ecosystem or atlas. Casual phrasings still count: "what\'s new?", "any updates?", or "what changed?" ask about recent changes — facts. When unsure: false.',
].join("\n");

export async function judgeSmalltalk(params: {
  call: JsonCall;
  model: string;
  question: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  obs?: ErrorContext;
}): Promise<SmalltalkJudgeRun> {
  try {
    const res = await callWithTimeout(
      params.call,
      {
        model: params.model,
        messages: [
          { role: "system", content: JUDGE_PROMPT },
          { role: "user", content: params.question.slice(0, 2000) },
        ],
        maxTokens: 50,
      },
      params.timeoutMs ?? 5000,
      params.signal,
    );
    const raw = res.text.match(/\{[^}]*\}/)?.[0];
    const parsed = raw ? (JSON.parse(raw) as { smalltalk?: unknown }) : null;
    if (!parsed) {
      captureEvent("chat_smalltalk_judge_unparseable", params.obs, { model: params.model, text_preview: res.text.slice(0, 120) });
    }
    return { smalltalk: parsed?.smalltalk === true, usage: res.usage, generationId: res.generationId, latencyMs: res.latencyMs };
  } catch (err) {
    captureError(err, params.obs, { stage: "smalltalk_judge", model: params.model });
    return { smalltalk: false, usage: null, generationId: null, latencyMs: null };
  }
}
