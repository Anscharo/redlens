// Manual PostHog AI events for OpenRouter calls the @posthog/ai wrapper cannot
// see: Jev (`/systemone`) and embeddings (`/embeddings`) are raw fetches, so
// their spend never reached PostHog while chat completions did. Same event
// names and property keys the wrapper emits, so they sit in one LLM-analytics
// view and `chat_surface` splits every kind of spend by one property:
//   atlas-chat / atlas-chat-verify / -summary / -title / -teach-review  (wrapper, llm.ts)
//   jev:<task> + jev_task=<task>: prefetch-judge, smalltalk, answer-coverage,
//     cite-support, cite-metadata, refute-screen                        (askJev)
//   embed-query / embed-batch                                          (embed.ts)
import { openrouterEnvironment } from "./openrouter-attribution.ts";
import { getPosthog } from "./posthog-node.ts";

export interface AiCall {
  kind: "generation" | "embedding";
  surface: string;
  /** Jev only: which task made the call, as its own property (group-by without parsing `chat_surface`). */
  jevTask?: string;
  model: string;
  inputTokens: number;
  outputTokens?: number;
  costUsd?: number | null;
  latencyMs: number;
  distinctId?: string;
  traceId?: string;
}

// Best-effort and silent when POSTHOG_KEY is unset, like every other capture
// helper. Success only: a failed request is billed nothing and is reported by
// the caller's own error path. No prompt/response text — these lanes carry
// user questions and answer text, and `CHAT_CAPTURE_CONTENT` is chat-only.
export function captureAiCall(c: AiCall): void {
  const ph = getPosthog();
  if (!ph) return;
  try {
    ph.capture({
      distinctId: c.distinctId ?? "server",
      event: c.kind === "embedding" ? "$ai_embedding" : "$ai_generation",
      properties: {
        $ai_provider: "openrouter",
        $ai_model: c.model,
        $ai_input_tokens: c.inputTokens,
        ...(c.outputTokens !== undefined ? { $ai_output_tokens: c.outputTokens } : {}),
        ...(typeof c.costUsd === "number" ? { $ai_total_cost_usd: c.costUsd } : {}),
        $ai_latency: c.latencyMs / 1000,
        ...(c.traceId ? { $ai_trace_id: c.traceId } : {}),
        chat_surface: c.surface,
        ...(c.jevTask ? { jev_task: c.jevTask } : {}),
        environment: openrouterEnvironment(),
        ...(c.distinctId ? {} : { $process_person_profile: false }),
      },
    });
  } catch {
    /* telemetry must never break a request */
  }
}
