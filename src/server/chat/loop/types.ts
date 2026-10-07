// The agentic loop's wire and state types. chat-loop.ts re-exports the public
// ones, so importers keep reading them from there.
import type OpenAI from "openai";
import type { Indexes } from "../../retrieval/indexes.ts";
import type { ErrorContext } from "../../posthog-node.ts";
import type { JsonCall } from "../llm.ts";
import type { ToolCallContext } from "../tools/tool-context.ts";

export type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;
export type Chunk = OpenAI.Chat.Completions.ChatCompletionChunk;

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
  truncated?: boolean;
  originalBytes?: number;
}

export type ChatEvent =
  | { type: "token"; text: string }
  // Incremental reasoning/"thinking" trace from a model that emits one.
  // NEVER accumulated into `content` and never part of done.content — it is
  // the model's scratch work, shown to the reader as it arrives, not answer text.
  | { type: "reasoning"; text: string }
  // End the live answer buffer for the round just ended. Some models leak
  // <tool_call> sentinel fragments as content before the structured call.
  // The client moves the live buffer on `clear`; done.content is the
  // authoritative final answer.
  //
  // `reason` tells the client what to do with text the reader already saw.
  // Optional for back-compat: an older client without this field wipes on
  // every clear.
  //   - tool_round — the round produced text AND tool calls. The client
  //     folds leaked tool-call markup into thinking and keeps remaining
  //     prose as an unverified draft (dimmed, not struck). Not a wipe.
  //   - degenerate — the draft degenerated into a repetition loop and was
  //     abandoned. The one reason that still wipes.
  | { type: "clear"; reason?: "tool_round" | "degenerate" }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; ok: boolean; bytes: number; truncated?: boolean; originalBytes?: number }
  // A downloadable artifact the model asked to hand the user (export_findings).
  // The loop builds it and yields it straight to the client (a tool handler
  // can't — it only returns JSON to the model); `content` is the whole file.
  | { type: "export"; format: "markdown" | "csv"; filename: string; mime: string; content: string; bytes: number }
  | {
      type: "done";
      content: string;
      usage: { input: number; output: number };
      // The LAST llm round's usage.prompt_tokens seen this turn — the real
      // context size of the round that produced the shipped answer. NOT the
      // same as usage.input above, which ACCUMULATES prompt_tokens across
      // every tool round and overstates context 2-3x on a multi-round turn.
      // null if no usage chunk was ever seen (e.g. aborted before one arrived).
      contextTokens: number | null;
      generationId: string | null;
      toolCalls: ToolCallRecord[];
      // True when the final completion hit config.chatMaxOutputTokens and was
      // cut off mid-generation (finish_reason "length") rather than ending on
      // its own — the harness treats this as a hard failure so a truncated
      // answer never ships silently as if it were complete.
      lengthCapped: boolean;
      // Full message array incl. tool results — the verifier's evidence
      // source. INTERNAL: the SSE route strips it (sanitizeDone) before it
      // ever reaches a client.
      transcript: Msg[];
    };

// Per-round notification for the orchestrator's pipelined checks. Fired after
// the round's tool calls all resolved; fire-and-forget — it cannot block or
// mutate the loop.
export interface RoundInfo {
  iter: number;
  calls: { name: string; args: Record<string, unknown> }[];
  results: { name: string; ok: boolean; content: string; truncated: boolean }[];
}

export interface RunChatOpts {
  ix: Indexes;
  messages: Msg[];
  stream: ChatStream;
  signal?: AbortSignal;
  maxIterations?: number;
  onRoundEnd?: (info: RoundInfo) => void;
  obs?: ErrorContext;
  jsonCall?: JsonCall;
  userQuestion?: string;
  toolCtx?: ToolCallContext;
}

/** Usage and generation id, accumulated across every request of one turn. */
export interface StreamAcc {
  usageIn: number;
  usageOut: number;
  contextTokens: number | null;
  generationId: string | null;
}

/** One turn's mutable loop state. `msgs` is the transcript as it grows. */
export interface LoopCtx extends StreamAcc {
  opts: RunChatOpts;
  msgs: Msg[];
  max: number;
  toolCalls: ToolCallRecord[];
  // Promised-tool guard: one retry per turn, and the steer it hands the replay.
  promisedToolRetried: boolean;
  pendingSteer: string | null;
}

export interface PendingCall {
  id: string;
  name: string;
  args: string;
}

/** What one streamed model request produced. */
export interface RoundOutput {
  content: string;
  finishReason: string | null;
  degenerated: boolean;
  pending: Map<number, PendingCall>;
}
