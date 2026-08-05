// OpenRouter chat client via the openai SDK (raw SDK, pointed at OpenRouter —
// see the chatbot plan; OpenRouter is the provider-abstraction layer, so a
// model/provider swap is a one-config CHAT_MODEL change). Embeddings keep their
// own direct-fetch path in embed.ts; this is the chat-completions surface only.
import OpenAI from "openai";
import { OpenAI as PostHogOpenAI } from "@posthog/ai/openai";
import { config } from "../config.ts";
import { getPosthog } from "../posthog-node.ts";
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

// Per-request PostHog attribution for one chat turn. distinctId is the
// CONVERSATION id, not the signed-in user — PostHog groups a conversation's
// turns together without ever learning who the user is. traceId groups every
// generation of a single turn — the answer stream AND the harness's
// verifier/advisor/revision rounds — under one trace in the LLM view. Use a
// fresh per-turn id (not the conversation id): a trace is one turn's work, so
// human think-time between turns never inflates trace-level latency.
export interface ChatObservability {
  distinctId?: string;
  traceId?: string;
  properties?: Record<string, unknown>;
}

// posthog* params for a create() body — only when PostHog is on (else the plain
// fallback client would forward them to OpenRouter). privacyMode is inverted from
// config.chatCaptureContent: false (the default) captures $ai_input/$ai_output_choices
// (the actual prompt/response text) alongside token/latency/cost metadata; set
// CHAT_CAPTURE_CONTENT=0 to fall back to metadata-only.
function posthogParams(obs: ChatObservability, surface: string): Record<string, unknown> {
  if (!getPosthog()) return {};
  return {
    posthogDistinctId: obs.distinctId,
    posthogTraceId: obs.traceId,
    posthogPrivacyMode: !config.chatCaptureContent,
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

// Run a JsonCall under a hard deadline that ACTUALLY cancels the provider
// request on timeout — not just a Promise.race that leaves the call running.
// The harness's verifier/advisor stream the answer first, so a hung judge must
// both stop blocking the terminal event AND stop burning tokens after the turn.
// We abort a controller wired into the call's signal (combined with the caller's
// signal, so a client disconnect still cancels). On timeout the call rejects
// (AbortError), which each caller already degrades to unverified / annotate-only.
export function callWithTimeout(
  call: JsonCall,
  args: { model: string; messages: Msg[]; maxTokens?: number },
  timeoutMs: number,
  signal?: AbortSignal,
): ReturnType<JsonCall> {
  const ac = new AbortController();
  const combined = signal ? AbortSignal.any([signal, ac.signal]) : ac.signal;
  let timer: ReturnType<typeof setTimeout>;
  // On timeout we do BOTH: abort the provider request (so it stops burning
  // tokens) AND reject now, so we don't hang waiting for the request to honor
  // the abort — the caller degrades to unverified / annotate-only immediately.
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ac.abort(new Error("llm call timeout"));
      reject(new Error("llm call timeout"));
    }, timeoutMs);
  });
  return Promise.race([call({ ...args, signal: combined }), timeout]).finally(() =>
    clearTimeout(timer),
  ) as ReturnType<JsonCall>;
}

// Build a JsonCall bound to one turn's observability context. Used for the
// harness's verifier/advisor roles so their generations land in the SAME trace as
// the answer stream (chat.ts passes the shared per-turn obs). When PostHog is off
// this is exactly the old plain-client behavior.
export function makeOpenrouterJson(obs: ChatObservability = {}, surface = "atlas-chat-verify"): JsonCall {
  return async ({ model, messages, maxTokens, signal }) => {
    const t0 = Date.now();
    const res = await getChatClient().chat.completions.create(
      {
        model,
        messages,
        temperature: 0,
        response_format: { type: "json_object" },
        ...(maxTokens ? { max_tokens: maxTokens } : {}),
        ...posthogParams(obs, surface),
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
        temperature: config.chatTemperature,
        max_tokens: config.chatMaxOutputTokens,
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
