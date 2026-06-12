// OpenRouter chat client via the openai SDK (raw SDK, pointed at OpenRouter —
// see the chatbot plan; OpenRouter is the provider-abstraction layer, so a
// model/provider swap is a one-config CHAT_MODEL change). Embeddings keep their
// own direct-fetch path in embed.ts; this is the chat-completions surface only.
import OpenAI from "openai";
import { config } from "./config.ts";
import type { ChatStream } from "./chat-loop.ts";

let client: OpenAI | null = null;

// Lazy singleton — constructing without a key is fine; the loop guards on it.
export function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: config.openrouterApiKey,
      baseURL: config.openrouterBaseUrl,
      // OpenRouter ranking/attribution headers (optional but recommended).
      defaultHeaders: { "X-Title": "RedLens Atlas" },
    });
  }
  return client;
}

// getModel keeps the model id behind one indirection so swapping providers/models
// stays a config change, never a code edit at call sites.
export function getModel(): string {
  return config.chatModel;
}

// Concrete ChatStream backing runChat(). stream_options.include_usage is
// load-bearing: without it streamed completions return no usage object and the
// token-window rate limit has nothing to count. Passes the request AbortSignal
// through so a closed connection cancels the upstream generation.
export const openrouterStream: ChatStream = async function* ({ messages, tools, toolChoice, signal }) {
  const stream = await getClient().chat.completions.create(
    {
      model: getModel(),
      messages,
      tools,
      tool_choice: toolChoice,
      stream: true,
      stream_options: { include_usage: true },
    },
    { signal },
  );
  for await (const chunk of stream) yield chunk;
};
