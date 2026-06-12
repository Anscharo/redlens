// Pure agentic chat loop. The LLM is injected (ChatStream), so this whole module
// unit-tests with a fake stream — no network, no API key, no Postgres. The SSE
// handler (Task: /api/chat) wraps a real OpenRouter stream around it and handles
// auth + persistence; this file owns only the tool-calling control flow.
//
// Constraints baked in (see chatbot-plan + advisor):
//   - hard maxIterations cap (the system-prompt budget is advisory)
//   - final allowed iteration forces tool_choice:"none" → a text answer, never a
//     dangling tool round
//   - aborts mid-stream on signal (orphaned tool rounds burn tokens)
//   - usage + generation id are surfaced for rate-limiting + cost backfill
import type OpenAI from "openai";
import { execTool } from "./llm-tools.ts";
import { CHAT_TOOLS } from "./llm-tools.ts";
import { safeParseArgs } from "./llm-tools.ts";
import { config } from "./config.ts";
import type { Indexes } from "./indexes.ts";

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type Chunk = OpenAI.Chat.Completions.ChatCompletionChunk;

export type ChatStream = (params: {
  messages: Msg[];
  tools: OpenAI.Chat.Completions.ChatCompletionTool[];
  toolChoice: "auto" | "none";
  signal?: AbortSignal;
}) => AsyncIterable<Chunk>;

export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  bytes: number;
}

export type ChatEvent =
  | { type: "token"; text: string }
  // Discard any answer tokens streamed in the round just ended — it turned out
  // to be a tool round, and some models leak <tool_call> sentinel fragments as
  // content before the structured call. The client resets its live answer
  // buffer on `clear`; done.content is the authoritative final answer.
  | { type: "clear" }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; ok: boolean; bytes: number }
  | {
      type: "done";
      content: string;
      usage: { input: number; output: number };
      generationId: string | null;
      toolCalls: ToolCallRecord[];
    };

interface PendingCall {
  id: string;
  name: string;
  args: string;
}

export async function* runChat(opts: {
  ix: Indexes;
  messages: Msg[];
  stream: ChatStream;
  signal?: AbortSignal;
  maxIterations?: number;
}): AsyncGenerator<ChatEvent> {
  const msgs: Msg[] = [...opts.messages];
  const max = Math.max(1, opts.maxIterations ?? config.chatMaxIterations);
  const toolCalls: ToolCallRecord[] = [];
  let usageIn = 0;
  let usageOut = 0;
  let generationId: string | null = null;

  for (let iter = 0; iter < max; iter++) {
    if (opts.signal?.aborted) break;
    const last = iter === max - 1;

    const stream = opts.stream({
      messages: msgs,
      tools: CHAT_TOOLS,
      toolChoice: last ? "none" : "auto",
      signal: opts.signal,
    });

    let content = "";
    let finishReason: string | null = null;
    const pending = new Map<number, PendingCall>();

    for await (const chunk of stream) {
      if (opts.signal?.aborted) break;
      // OpenRouter exposes the generation id as the chunk id (gen-…); the cost
      // reconciler later looks this up. Prefer it over the SDK header access.
      // NOTE: multi-round answers have one gen-id per round; we keep only the
      // last, so async cost backfill undercounts multi-round cost (v1 concern).
      if (typeof chunk.id === "string" && chunk.id.startsWith("gen-")) generationId = chunk.id;

      const choice = chunk.choices?.[0];
      if (choice?.delta?.content) {
        content += choice.delta.content;
        yield { type: "token", text: choice.delta.content };
      }
      for (const tc of choice?.delta?.tool_calls ?? []) {
        const slot = pending.get(tc.index) ?? { id: "", name: "", args: "" };
        if (tc.id) slot.id = tc.id;
        if (tc.function?.name) slot.name += tc.function.name;
        if (tc.function?.arguments) slot.args += tc.function.arguments;
        pending.set(tc.index, slot);
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      // include_usage emits ONE usage chunk per request, and we make one request
      // per tool round — so ACCUMULATE across rounds (overwriting would record
      // only the final round and undercount the rate-limit gate 2–3× on
      // tool-heavy answers).
      if (chunk.usage) {
        usageIn += chunk.usage.prompt_tokens ?? 0;
        usageOut += chunk.usage.completion_tokens ?? 0;
      }
    }

    if (opts.signal?.aborted) break;

    // A tool round (never on the forced-text final iteration).
    if (finishReason === "tool_calls" && pending.size > 0 && !last) {
      // This round's streamed content was pre-tool noise — tell the client to drop it.
      if (content) yield { type: "clear" };
      const calls = [...pending.values()];
      msgs.push({
        role: "assistant",
        content: content || null,
        tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.args } })),
      });
      for (const c of calls) {
        const args = safeParseArgs(c.args);
        yield { type: "tool_call", name: c.name, args };
        const result = await execTool(opts.ix, c.name, c.args);
        const ok = !result.startsWith('{"error"');
        toolCalls.push({ name: c.name, args, ok, bytes: result.length });
        yield { type: "tool_result", name: c.name, ok, bytes: result.length };
        msgs.push({ role: "tool", tool_call_id: c.id, content: result });
      }
      continue;
    }

    // Otherwise this streamed content is the final answer.
    yield { type: "done", content, usage: { input: usageIn, output: usageOut }, generationId, toolCalls };
    return;
  }

  // Reached only if aborted, or maxIterations somehow exhausted without a text
  // answer. Emit a terminal event so callers can persist + close cleanly.
  yield { type: "done", content: "", usage: { input: usageIn, output: usageOut }, generationId, toolCalls };
}
