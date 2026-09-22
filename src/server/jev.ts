// Jev (TypeSafe System One) client — typed judgments, not text. Reaches
// OpenRouter's `/systemone` endpoint, NOT `/chat/completions`, so it bypasses
// the `openai` SDK client and the `@posthog/ai` wrapper entirely: it is a raw
// fetch, exactly like `retrieval/embed.ts`, and rides the same
// OPENROUTER_API_KEY. A consequence worth knowing: PostHog's `$ai_generation`
// auto-capture does NOT see these calls — a caller that wants them tracked
// must captureEvent itself.
//
// The model returns a probability (Noul), a distribution over a closed option
// set (Choice), or a level (Score) — never prose. Questions posted together
// run in parallel over ONE `state` and are blind to each other, so a caller
// that needs answer A to build state B must make two requests.
import { config } from "./config.ts";

// `questions` is a RECORD keyed by caller-chosen id, not an array — the API
// rejects an array outright. Ids are for code only; they are never shown to
// the model, so the question must carry its full meaning in `instructions`.
export interface JevQuestion {
  type: "noul" | "choice" | "score";
  // String for a simple judgment; object/array when definitions, contrasts or
  // examples clarify it. `criteria` is optional for Noul, required for the
  // other two.
  instructions: unknown;
  criteria?: unknown;
}

export interface JevNoulAnswer {
  type: "noul";
  /** P(yes), 0–1. No separate confidence: the single number IS the distribution. */
  noul: number;
}
export interface JevChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  /** Distribution concentration — NOT a licence to act, and not correctness. */
  confidence: number;
}
export interface JevScoreAnswer {
  type: "score";
  score: number;
  probabilities?: Record<string, number>;
  confidence?: number;
}
export type JevAnswer = JevNoulAnswer | JevChoiceAnswer | JevScoreAnswer;

export interface JevRun {
  answers: Record<string, JevAnswer>;
  usage: { input: number; output: number } | null;
  /** Dollars, reported inline by the endpoint — no price table to keep in sync. */
  cost: number | null;
  /** `gen-dec-…` — same `gen-` shape as chat generations, so message_checks.generation_id holds it unchanged. */
  generationId: string | null;
  latencyMs: number;
}

interface JevResponse {
  model?: string;
  answers?: Record<string, JevAnswer>;
  usage?: { input_tokens?: number; output_tokens?: number; cost?: number };
  id?: string;
}

/** Narrowing helper — an answer of the wrong type is a question-definition bug, not a runtime branch. */
export function noulOf(run: JevRun, id: string): number | null {
  const a = run.answers[id];
  return a && a.type === "noul" && typeof a.noul === "number" ? a.noul : null;
}

export function choiceOf(run: JevRun, id: string): JevChoiceAnswer | null {
  const a = run.answers[id];
  return a && a.type === "choice" && typeof a.choice === "string" ? a : null;
}

// Retries mirror retrieval/embed.ts: bounded exponential backoff, and an
// aborted signal (caller gave up / timed out) stops the loop immediately
// rather than retrying against a request nobody is waiting for. A 4xx other
// than 429 is a malformed question — retrying it just burns the same error,
// so it throws on the first try.
export async function askJev(params: {
  state: unknown;
  questions: Record<string, JevQuestion>;
  model?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  attempt?: number;
}): Promise<JevRun> {
  if (!config.openrouterApiKey) throw new Error("OPENROUTER_API_KEY is not set");
  const model = params.model || config.chatJevModel;
  if (!model) throw new Error("no Jev model configured (CHAT_JEV_MODEL is empty)");

  const attempt = params.attempt ?? 0;
  const timeoutMs = params.timeoutMs ?? 10_000;
  const timer = AbortSignal.timeout(timeoutMs);
  const signal = params.signal ? AbortSignal.any([params.signal, timer]) : timer;
  const t0 = Date.now();
  try {
    const res = await fetch(`${config.openrouterBaseUrl}/systemone`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.openrouterApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model, state: params.state, questions: params.questions }),
      signal,
    });
    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 300);
      const err = new Error(`systemone ${res.status}: ${body}`);
      // Only 429 and 5xx are worth another attempt.
      if (res.status !== 429 && res.status < 500) throw Object.assign(err, { fatal: true });
      throw err;
    }
    const json = (await res.json()) as JevResponse;
    if (!json.answers || typeof json.answers !== "object") {
      throw Object.assign(new Error(`systemone: no answers in response`), { fatal: true });
    }
    return {
      answers: json.answers,
      usage: json.usage ? { input: json.usage.input_tokens ?? 0, output: json.usage.output_tokens ?? 0 } : null,
      cost: json.usage?.cost ?? null,
      generationId: json.id ?? null,
      latencyMs: Date.now() - t0,
    };
  } catch (err) {
    if ((err as { fatal?: boolean }).fatal || params.signal?.aborted || attempt >= 3) throw err;
    const wait = 500 * 2 ** attempt;
    console.warn(`  jev retry ${attempt + 1} in ${wait}ms: ${(err as Error).message}`);
    await Bun.sleep(wait);
    if (params.signal?.aborted) throw err;
    return askJev({ ...params, attempt: attempt + 1 });
  }
}
