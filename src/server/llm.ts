// OpenRouter chat client via the openai SDK (raw SDK, pointed at OpenRouter —
// see the chatbot plan; OpenRouter is the provider-abstraction layer, so a
// model/provider swap is a one-config CHAT_MODEL change). Embeddings keep their
// own direct-fetch path in embed.ts; this is the chat-completions surface only.
import OpenAI from "openai";
import { OpenAI as PostHogOpenAI } from "@posthog/ai/openai";
import { config } from "./config.ts";
import { getPosthog } from "./posthog-node.ts";
import type { ChatStream } from "./chat-loop.ts";

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

const DEFAULT_HEADERS = { "X-Title": "Sky Atlas by Redline" }; // OpenRouter attribution.

let client: OpenAI | null = null;

// Lazy singleton — constructing without a key is fine; the loop guards on it.
// Plain (un-instrumented) client: used by offline history curation, the harness
// JSON calls, and as the fallback when PostHog is disabled.
export function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: config.openrouterApiKey,
      baseURL: config.openrouterBaseUrl,
      defaultHeaders: DEFAULT_HEADERS,
    });
  }
  return client;
}

// Chat-completions client for the live /api/chat surface. When PostHog is
// configured it's the @posthog/ai wrapper, which emits one `$ai_generation` event
// per completion (the wrapper subclasses OpenAI, so it's a drop-in). Without a key
// it's the plain client — so the un-instrumented path never carries posthog* params
// to OpenRouter, and construction stays keyless-safe.
let chatClient: OpenAI | null = null;
function getChatClient(): OpenAI {
  if (chatClient) return chatClient;
  const posthog = getPosthog();
  chatClient = posthog
    ? new PostHogOpenAI({
        apiKey: config.openrouterApiKey,
        baseURL: config.openrouterBaseUrl,
        defaultHeaders: DEFAULT_HEADERS,
        posthog,
      })
    : getClient();
  return chatClient;
}

// getModel keeps the model id behind one indirection so swapping providers/models
// stays a config change, never a code edit at call sites.
export function getModel(): string {
  return config.chatModel;
}

// Per-request PostHog attribution for one chat turn. distinctId is the signed-in
// user; traceId groups every generation of a single turn — the answer stream AND
// the harness's verifier/advisor/revision rounds — under one trace in the LLM view.
// Use a fresh per-turn id (not the conversation id): a trace is one turn's work, so
// human think-time between turns never inflates trace-level latency. The
// conversation id rides along as a filterable property instead.
export interface ChatObservability {
  distinctId?: string;
  traceId?: string;
  properties?: Record<string, unknown>;
}

// posthog* params for a create() body — only when PostHog is on (else the plain
// fallback client would forward them to OpenRouter). privacyMode: true → metadata
// only (model, tokens, latency, cost), no prompt/response text, matching the
// anonymous-by-default posture of the rest of the analytics stack.
function posthogParams(obs: ChatObservability, surface: string): Record<string, unknown> {
  if (!getPosthog()) return {};
  return {
    posthogDistinctId: obs.distinctId,
    posthogTraceId: obs.traceId,
    posthogPrivacyMode: true,
    posthogProperties: { chat_surface: surface, ...obs.properties },
  };
}

// Non-streamed JSON-mode call for the reliability harness's grader/planner
// roles (verifier, advisor). temperature:0 — these are judges, not writers.
// The injection seam mirroring ChatStream: orchestrator/verifier/advisor unit
// tests swap in a fake JsonCall, no network.
export type JsonCall = (params: {
  model: string;
  messages: Msg[];
  maxTokens?: number;
  signal?: AbortSignal;
}) => Promise<{ text: string; usage: { input: number; output: number }; generationId: string | null; latencyMs: number }>;

// Build a JsonCall bound to one turn's observability context. Used for the
// harness's verifier/advisor roles so their generations land in the SAME trace as
// the answer stream (chat.ts passes the shared per-turn obs). When PostHog is off
// this is exactly the old plain-client behavior.
export function makeOpenrouterJson(obs: ChatObservability = {}): JsonCall {
  return async ({ model, messages, maxTokens, signal }) => {
    const t0 = Date.now();
    const res = await getChatClient().chat.completions.create(
      {
        model,
        messages,
        temperature: 0,
        response_format: { type: "json_object" },
        ...(maxTokens ? { max_tokens: maxTokens } : {}),
        ...posthogParams(obs, "atlas-chat-verify"),
      } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
      { signal },
    );
    return {
      text: res.choices[0]?.message?.content ?? "",
      usage: { input: res.usage?.prompt_tokens ?? 0, output: res.usage?.completion_tokens ?? 0 },
      generationId: typeof res.id === "string" && res.id.startsWith("gen-") ? res.id : null,
      latencyMs: Date.now() - t0,
    };
  };
}

// Anonymous default (no request context) — for callers/tests without a session.
export const openrouterJson: JsonCall = makeOpenrouterJson();

// Build a ChatStream bound to one turn's observability context. runChat stays
// PostHog-agnostic (it only consumes ChatStream); chat.ts supplies the context.
// stream_options.include_usage is load-bearing: without it streamed completions
// return no usage object and the token-window rate limit has nothing to count.
// `models` is the per-turn chain from the tier router (model-router.ts): first
// entry primary, rest sent as OpenRouter's `models` fallback list so provider
// failures retry server-side. Empty = the plain CHAT_MODEL behavior.
export function makeOpenrouterStream(obs: ChatObservability = {}, models: string[] = []): ChatStream {
  const chain = models.length ? models : [getModel()];
  return async function* ({ messages, tools, toolChoice, signal }) {
    const stream = await getChatClient().chat.completions.create(
      {
        model: chain[0],
        ...(chain.length > 1 ? { models: chain } : {}),
        messages,
        tools,
        tool_choice: toolChoice,
        stream: true,
        stream_options: { include_usage: true },
        ...posthogParams(obs, "atlas-chat"),
      } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
      { signal },
    );
    for await (const chunk of stream) yield chunk;
  };
}

// Anonymous default stream (no request context) — for callers/tests that run the
// loop without a session.
export const openrouterStream: ChatStream = makeOpenrouterStream();
