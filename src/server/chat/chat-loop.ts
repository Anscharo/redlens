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
import { execToolDetailed } from "./tools/llm-tools.ts";
import { CHAT_TOOLS } from "./tools/llm-tools.ts";
import { safeParseArgs } from "./tools/llm-tools.ts";
import { EXPORT_TOOL_NAME, buildExportArtifact, redactExportArgs } from "./tools/export-tool.ts";
import { checkExportArtifact } from "./tools/export-verify.ts";
import { config } from "../config.ts";
import type { Indexes } from "../retrieval/indexes.ts";
import { captureError, captureEvent, type ErrorContext } from "../posthog-node.ts";

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
  truncated?: boolean;
  originalBytes?: number;
}

export type ChatEvent =
  | { type: "token"; text: string }
  // Discard any answer tokens streamed in the round just ended — it turned out
  // to be a tool round, and some models leak <tool_call> sentinel fragments as
  // content before the structured call. The client resets its live answer
  // buffer on `clear`; done.content is the authoritative final answer.
  | { type: "clear" }
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
      generationId: string | null;
      toolCalls: ToolCallRecord[];
      // True when the final completion hit config.chatMaxOutputTokens and was
      // cut off mid-generation (finish_reason "length") rather than ending on
      // its own — the harness treats this as a hard failure so a truncated
      // answer never ships silently as if it were complete.
      lengthCapped: boolean;
      // Full message array incl. tool results — the verifier's evidence source
      // and the base for a revision run. INTERNAL: the SSE route strips it
      // (sanitizeDone) before it ever reaches a client.
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

interface PendingCall {
  id: string;
  name: string;
  args: string;
}

// The tool-result wire format for a failed call (see llm-tools.ts). Shared
// with round-checks.ts so the UI's per-call ok badge and the harness's
// errorResults telemetry can never disagree about what counts as an error.
export function isErrorResult(content: string): boolean {
  return content.startsWith('{"error"');
}

// Injected only on the final iteration, where tool_choice flips to "none" and the
// model MUST return text. Without it, a model that hasn't found what it wanted
// tends to narrate one more search ("Let me look up X…") as its answer — which,
// since it can't call tools, becomes a dangling non-answer the user sees verbatim.
// This forces a real answer or an honest "not found" instead.
const FINAL_TURN_INSTRUCTION =
  "This is your final turn — no more tools are available. Write the complete answer now, using only the evidence already gathered above. Cite sources as instructed. If the gathered evidence does not answer the question, say plainly that the atlas does not appear to cover it and summarize what you did find. Do NOT describe further searches or say you will look something up — just answer.";

// Compose guard steer (one-shot, docs/plans/chat-staged-delivery.md prereq).
// Even the forced-text final round can come back EMPTY — e.g. a model emitting
// tool-call deltas despite tool_choice:"none" leaves content blank, and both
// arms of the 2026-08-06 eval A/B shipped "" that way after burning every
// round on retrieval. A turn must never end with nothing: this steers one
// extra no-tools request toward an answer-or-honest-abstention.
const COMPOSE_STEER =
  "Your research budget is exhausted — no tools are available. Using ONLY the evidence in the conversation above, write your final answer now. If the evidence does not answer the question, state plainly what you searched for and what was not found; a precise, honest summary of the gap IS the correct answer. Do not mention tools or further searches.";

// Injected transiently on every mid-loop turn after the first tool round. The
// chat model tends to over-search — simple single-document questions were
// burning 4–6 rounds before answering. This nudges "answer as soon as the
// evidence suffices" without capping rounds for genuinely complex questions.
// Like FINAL_TURN_INSTRUCTION it rides only the request, never lands in msgs.
const EARLY_ANSWER_NUDGE =
  "Check the tool results above before searching again: if they already contain what the question needs, write the final answer now instead of calling more tools. Simple questions about a single document rarely need more than one or two lookups. Only continue if a specific fact you need is still missing — and never re-run a near-identical query.";

export async function* runChat(opts: {
  ix: Indexes;
  messages: Msg[];
  stream: ChatStream;
  signal?: AbortSignal;
  maxIterations?: number;
  onRoundEnd?: (info: RoundInfo) => void;
  obs?: ErrorContext;
}): AsyncGenerator<ChatEvent> {
  const msgs: Msg[] = [...opts.messages];
  const max = Math.max(1, opts.maxIterations ?? config.chatMaxIterations);
  const toolCalls: ToolCallRecord[] = [];
  let usageIn = 0;
  let usageOut = 0;
  let generationId: string | null = null;

  // One-shot compose guard: a no-tools request with the answer-or-abstain
  // steer. Yields tokens like a normal answer round; tool-call deltas a model
  // emits anyway are ignored (there is nothing left to execute them with).
  // The steer rides only the request, never lands in msgs — same policy as
  // FINAL_TURN_INSTRUCTION.
  async function* composeFinal(): AsyncGenerator<ChatEvent, { content: string; lengthCapped: boolean }> {
    let content = "";
    let finishReason: string | null = null;
    const stream = opts.stream({
      messages: [...msgs, { role: "system", content: COMPOSE_STEER }],
      tools: CHAT_TOOLS,
      toolChoice: "none",
      signal: opts.signal,
    });
    for await (const chunk of stream) {
      if (opts.signal?.aborted) break;
      if (typeof chunk.id === "string" && chunk.id.startsWith("gen-")) generationId = chunk.id;
      const choice = chunk.choices?.[0];
      if (choice?.delta?.content) {
        content += choice.delta.content;
        yield { type: "token", text: choice.delta.content };
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      if (chunk.usage) {
        usageIn += chunk.usage.prompt_tokens ?? 0;
        usageOut += chunk.usage.completion_tokens ?? 0;
      }
    }
    return { content, lengthCapped: finishReason === "length" };
  }

  for (let iter = 0; iter < max; iter++) {
    if (opts.signal?.aborted) break;
    const last = iter === max - 1;

    // Transient per-turn steering, never pushed onto msgs (not persisted, not
    // resent): the final forced-text turn gets the answer-now instruction; any
    // mid-loop turn after the first tool round gets the early-answer nudge.
    const steer = last ? FINAL_TURN_INSTRUCTION : iter > 0 ? EARLY_ANSWER_NUDGE : null;
    const turnMsgs: Msg[] = steer ? [...msgs, { role: "system", content: steer }] : msgs;

    const stream = opts.stream({
      messages: turnMsgs,
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

    // A tool round. Trust the accumulated `pending` map directly rather than
    // gating on finish_reason === "tool_calls": OpenRouter fans a tier out
    // across several providers (model-router.ts — gemma, glm, haiku, gpt-5-mini),
    // and not all of them report finish_reason:"tool_calls" for a round that
    // streamed tool_calls deltas — some report "stop". Gating on finish_reason
    // silently dropped those accumulated calls, and whatever (usually empty)
    // content had streamed became the final answer instead — an empty answer
    // that then gets persisted and filtered out by windowHistory, so the turn
    // vanishes. Still excluded on `last`, the forced-text final iteration
    // (toolChoice:"none"), where a tool round is never valid.
    //
    // A pending slot can be unusable — empty/missing id or name — if a stream
    // is cut short or a provider emits a malformed delta for an index that
    // never receives its function name. There is no tool to call and no id to
    // attach a "tool" result message to, so such slots are filtered out before
    // execution rather than sent to execToolDetailed. If that empties the round
    // entirely, this falls through to the plain-answer path below exactly as if
    // no tool_calls had streamed at all.
    const rawCalls = [...pending.values()];
    const calls = rawCalls.filter((c) => c.id && c.name);
    if (calls.length < rawCalls.length) {
      captureEvent("chat_loop_malformed_tool_call", opts.obs, {
        iter,
        dropped: rawCalls.length - calls.length,
        finishReason,
      });
    }
    // finish_reason:"length" means the stream was cut mid-generation — any
    // pending tool call has truncated `arguments` JSON, so executing it would
    // run the tool with wrong/empty args and hide the truncation from the
    // caller. Fall through to the answer path instead, which reports
    // lengthCapped: true (a hard failure) exactly as it did before pending
    // calls were trusted over finish_reason.
    if (calls.length > 0 && !last && finishReason !== "length") {
      // This round's streamed content was pre-tool noise — tell the client to drop it.
      if (content) yield { type: "clear" };
      msgs.push({
        role: "assistant",
        content: content || null,
        // The export tool's args carry the whole file body — redact it from the
        // retained transcript (it's already delivered to the user) so it isn't
        // re-sent every turn or fed unbudgeted into the verifier evidence.
        tool_calls: calls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: c.name === EXPORT_TOOL_NAME ? redactExportArgs(c.args) : c.args },
        })),
      });
      const parsedCalls = calls.map((c) => ({ id: c.id, name: c.name, raw: c.args, args: safeParseArgs(c.args) }));
      for (const c of parsedCalls) yield { type: "tool_call", name: c.name, args: c.args };
      // Execute the round's calls in parallel (pure latency win); results are
      // then emitted + pushed in call order for deterministic transcripts. The
      // export tool is chat-only and has no registry handler — it's built inline
      // in the result loop below (it must yield an `export` event, which a
      // Promise.all callback can't do), so it's skipped here.
      const results = await Promise.all(
        parsedCalls.map((c) => (c.name === EXPORT_TOOL_NAME ? Promise.resolve(null) : execToolDetailed(opts.ix, c.name, c.raw, opts.obs))),
      );
      const roundResults: RoundInfo["results"] = [];
      for (let i = 0; i < parsedCalls.length; i++) {
        const c = parsedCalls[i];

        // ── export_findings: build the artifact, hand the file to the client,
        // feed the model only a small ack (never the file body). ──────────────
        if (c.name === EXPORT_TOOL_NAME) {
          let ack: Record<string, unknown>;
          try {
            const art = buildExportArtifact(c.args as Parameters<typeof buildExportArtifact>[0]);
            // Deterministically verify the file body against this turn's evidence
            // (tool results + prior answers) BEFORE it downloads — the harness
            // only audits the chat answer, so an unchecked file could carry a
            // fabricated citation/quote/address. Withhold + tell the model to fix.
            const evidenceTexts = msgs
              .filter((m) => (m.role === "tool" || m.role === "assistant") && typeof m.content === "string")
              .map((m) => m.content as string);
            const check = checkExportArtifact(art, evidenceTexts, opts.ix);
            if (check.ok) {
              const bytes = check.content.length;
              yield { type: "export", format: art.format, filename: art.filename, mime: art.mime, content: check.content, bytes };
              ack = { ok: true, filename: art.filename, bytes, note: "Delivered to the user as a download." };
            } else {
              ack = {
                error: `export withheld — the file content failed verification: ${check.problems.join("; ")}. Correct these using only evidence retrieved this turn, then call export_findings again.`,
              };
            }
          } catch (e) {
            ack = { error: (e as Error).message };
          }
          const ackStr = JSON.stringify(ack);
          const ok = !isErrorResult(ackStr);
          toolCalls.push({ name: c.name, args: c.args, ok, bytes: ackStr.length });
          yield { type: "tool_result", name: c.name, ok, bytes: ackStr.length };
          msgs.push({ role: "tool", tool_call_id: c.id, content: ackStr });
          roundResults.push({ name: c.name, ok, content: ackStr, truncated: false });
          continue;
        }

        const result = results[i]!;
        const toolContent = result.content;
        const ok = !isErrorResult(toolContent);
        toolCalls.push({
          name: c.name,
          args: c.args,
          ok,
          bytes: result.returnedChars,
          ...(result.truncated ? { truncated: true, originalBytes: result.originalChars } : {}),
        });
        yield {
          type: "tool_result",
          name: c.name,
          ok,
          bytes: result.returnedChars,
          ...(result.truncated ? { truncated: true, originalBytes: result.originalChars } : {}),
        };
        msgs.push({ role: "tool", tool_call_id: c.id, content: toolContent });
        roundResults.push({ name: c.name, ok, content: toolContent, truncated: result.truncated });
      }
      try {
        opts.onRoundEnd?.({ iter, calls: parsedCalls.map((c) => ({ name: c.name, args: c.args })), results: roundResults });
      } catch (err) {
        // Observer errors must never break the loop, but are still worth knowing about.
        captureError(err, opts.obs, { stage: "on_round_end_observer" });
      }
      continue;
    }

    // Otherwise this streamed content is the final answer. If the round came
    // back EMPTY (not aborted), the compose guard buys exactly one more
    // no-tools attempt before the turn is allowed to end — an empty second
    // attempt ships as-is rather than retrying forever.
    let finalContent = content;
    let capped = finishReason === "length";
    if (!finalContent.trim() && !opts.signal?.aborted) {
      const composed = yield* composeFinal();
      finalContent = composed.content;
      capped = composed.lengthCapped;
    }
    yield {
      type: "done",
      content: finalContent,
      usage: { input: usageIn, output: usageOut },
      generationId,
      toolCalls,
      lengthCapped: capped,
      transcript: finalContent ? [...msgs, { role: "assistant", content: finalContent }] : [...msgs],
    };
    return;
  }

  // Reached only if aborted, or maxIterations somehow exhausted without a text
  // answer. Emit a terminal event so callers can persist + close cleanly.
  yield { type: "done", content: "", usage: { input: usageIn, output: usageOut }, generationId, toolCalls, lengthCapped: false, transcript: [...msgs] };
}
