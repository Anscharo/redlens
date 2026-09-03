// Pure agentic chat loop. The LLM is injected (ChatStream), so this whole module
// unit-tests with a fake stream — no network, no API key, no Postgres. The SSE
// handler (Task: /api/chat) wraps a real OpenRouter stream around it and handles
// auth + persistence; this file owns only the tool-calling control flow.
//
// Constraints baked in (see docs/plans/archive/chatbot-plan.md + advisor):
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
import { checkExportArtifact, type ExportEvidence } from "./tools/export-verify.ts";
import { config } from "../config.ts";
import { announcesUnmadeToolCall } from "./announcement.ts";
import type { Indexes } from "../retrieval/indexes.ts";
import { captureError, captureEvent, type ErrorContext } from "../posthog-node.ts";
import type { JsonCall } from "./llm.ts";
import { ASK_EXTERNAL_MSC, runAskExternalMsc } from "./tools/external-tools.ts";
import { isExternalMscTool } from "../external/envelope.ts";
import { isRepetitionLoop } from "./repetition-guard.ts";

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
  //   - revision — the advisor is replacing a COMPLETE answer the reader has
  //     already read. The client keeps that text, struck through, above the
  //     replacement. Never a wipe.
  //   - restore — a `revision` was started but abandoned, and the original
  //     answer is about to be re-sent in `done`. The client drops its kept
  //     copy so the answer is not shown twice.
  | { type: "clear"; reason?: "tool_round" | "degenerate" | "revision" | "restore" }
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

// OpenRouter normalises a provider's "thinking" trace onto `delta.reasoning`
// (a string), but some providers send `delta.reasoning_content` instead, and
// some send a `reasoning_details` array of parts. The OpenAI SDK's
// ChatCompletionChunk/delta type declares none of these — this is the one
// place that casts through the unknown shapes, so both chunk-consuming loops
// below read reasoning identically and can never drift.
export function reasoningDelta(delta: unknown): string {
  if (!delta || typeof delta !== "object") return "";
  const d = delta as { reasoning?: unknown; reasoning_content?: unknown; reasoning_details?: unknown };
  if (typeof d.reasoning === "string") return d.reasoning;
  if (typeof d.reasoning_content === "string") return d.reasoning_content;
  if (Array.isArray(d.reasoning_details)) {
    let out = "";
    for (const part of d.reasoning_details) {
      if (!part || typeof part !== "object") continue;
      const p = part as { text?: unknown; summary?: unknown };
      if (typeof p.text === "string") out += p.text;
      else if (typeof p.summary === "string") out += p.summary;
    }
    return out;
  }
  return "";
}

// Injected only on the final iteration, where tool_choice flips to "none" and the
// model MUST return text. Without it, a model that hasn't found what it wanted
// tends to narrate one more search ("Let me look up X…") as its answer — which,
// since it can't call tools, becomes a dangling non-answer the user sees verbatim.
// This forces a real answer or an honest "not found" instead.
const FINAL_TURN_INSTRUCTION =
  "This is your final turn — no more tools are available. Write the complete answer now, using only the evidence already gathered above. Cite sources as instructed. If the gathered evidence does not answer the question, say plainly that the atlas does not appear to cover it and summarize what you did find. Do NOT describe further searches or say you will look something up — just answer.";

// Compose guard steer (one-shot, docs/chat-system.md §4; staged-delivery prereq).
// Even the forced-text final round can come back EMPTY — e.g. a model emitting
// tool-call deltas despite tool_choice:"none" leaves content blank, and both
// arms of the 2026-08-06 eval A/B shipped "" that way after burning every
// round on retrieval. A turn must never end with nothing: this steers one
// extra no-tools request toward an answer-or-honest-abstention.
const COMPOSE_STEER =
  "Your research budget is exhausted — no tools are available. Using ONLY the evidence in the conversation above, write your final answer now. If the evidence does not answer the question, state plainly what you searched for and what was not found; a precise, honest summary of the gap IS the correct answer. Do not mention tools or further searches.";

// One-shot rewrite after the deterministic repetition handbrake trips (see
// repetition-guard.ts). The degenerate draft is cleared from the client and
// never pushed onto msgs — this steer alone asks for a clean rewrite.
const REPETITION_STEER =
  "Your previous draft collapsed into repetitive nonsense (the same phrase or character looping). Discard it entirely. Write the complete answer once, cleanly, with no repeated filler. If the evidence does not answer the question, say so briefly — do not pad.";

// One-shot steer for the promised-tool guard (chat/announcement.ts). The round
// wrote "let me look that up" and emitted no tool_call, so the loop was about
// to ship the promise as the answer. The announcement itself is never pushed
// onto msgs — the plain-answer path doesn't push, and this guard `continue`s
// before it — so the replay sees the conversation exactly as the failed round
// saw it and cannot mistake its own promise for a kept one.
const PROMISED_TOOL_STEER =
  "Your previous attempt announced a lookup ('let me check', 'one moment') but called no tool, so nothing was retrieved and the user received only that promise. Do not narrate what you are about to do. Call the tool you need NOW, in this turn, and then answer from its results. If the question genuinely needs no lookup, answer it directly and completely instead — but never reply with an intention to search.";

// Injected transiently on every mid-loop turn after the first tool round. The
// chat model tends to over-search — simple single-document questions were
// burning 4–6 rounds before answering. This nudges "answer as soon as the
// evidence suffices" without capping rounds for genuinely complex questions.
// Like FINAL_TURN_INSTRUCTION it rides only the request, never lands in msgs.
const EARLY_ANSWER_NUDGE =
  "Check the tool results above before searching again: if they already contain what the question needs, write the final answer now instead of calling more tools. Simple questions about a single document rarely need more than one or two lookups. Only continue if a specific fact you need is still missing — and never re-run a near-identical query.";

// Evidence for the export gate, split by provenance so a file built on the MSC
// brief faces the same non-Atlas attribution rules the harness applies to the
// chat answer (a file outlives the conversation — CLAUDE.md's citation dictate
// is strictest about it). Which tool_call_ids belong to the external tool is
// read back off the transcript rather than tracked in this loop's own state, so
// a revision pass — which replays the first pass's transcript through a fresh
// runChat — classifies those earlier rounds identically.
export function exportEvidence(msgs: Msg[]): ExportEvidence {
  const externalIds = new Set<string>();
  for (const m of msgs) {
    if (m.role !== "assistant" || !Array.isArray(m.tool_calls)) continue;
    for (const tc of m.tool_calls) {
      if (tc.type === "function" && isExternalMscTool(tc.function.name)) externalIds.add(tc.id);
    }
  }
  const atlasTexts: string[] = [];
  const externalTexts: string[] = [];
  for (const m of msgs) {
    if (typeof m.content !== "string") continue;
    if (m.role === "tool") (externalIds.has(m.tool_call_id) ? externalTexts : atlasTexts).push(m.content);
    else if (m.role === "assistant") atlasTexts.push(m.content);
  }
  return { atlasTexts, externalTexts };
}

export async function* runChat(opts: {
  ix: Indexes;
  messages: Msg[];
  stream: ChatStream;
  signal?: AbortSignal;
  maxIterations?: number;
  onRoundEnd?: (info: RoundInfo) => void;
  obs?: ErrorContext;
  jsonCall?: JsonCall;
  userQuestion?: string;
}): AsyncGenerator<ChatEvent> {
  const msgs: Msg[] = [...opts.messages];
  const max = Math.max(1, opts.maxIterations ?? config.chatMaxIterations);
  const toolCalls: ToolCallRecord[] = [];
  // Promised-tool guard: one retry per turn, and the steer it hands the replay.
  let promisedToolRetried = false;
  let pendingSteer: string | null = null;
  let usageIn = 0;
  let usageOut = 0;
  let contextTokens: number | null = null;
  let generationId: string | null = null;

  // One-shot no-tools text attempt (compose guard / repetition rewrite). Yields
  // tokens like a normal answer round; tool-call deltas a model emits anyway
  // are ignored. The steer rides only the request, never lands in msgs. Mid-
  // stream repetition aborts the provider call (local AbortController) and
  // returns degenerated:true so the caller can clear + decide.
  async function* forcedTextAttempt(
    steer: string,
  ): AsyncGenerator<ChatEvent, { content: string; lengthCapped: boolean; degenerated: boolean }> {
    let content = "";
    let finishReason: string | null = null;
    let degenerated = false;
    const ac = new AbortController();
    const signal = opts.signal ? AbortSignal.any([opts.signal, ac.signal]) : ac.signal;
    const stream = opts.stream({
      messages: [...msgs, { role: "system", content: steer }],
      tools: CHAT_TOOLS,
      toolChoice: "none",
      signal,
    });
    for await (const chunk of stream) {
      if (opts.signal?.aborted) break;
      if (typeof chunk.id === "string" && chunk.id.startsWith("gen-")) generationId = chunk.id;
      const choice = chunk.choices?.[0];
      const reasoning = reasoningDelta(choice?.delta);
      if (reasoning) yield { type: "reasoning", text: reasoning };
      if (choice?.delta?.content) {
        content += choice.delta.content;
        if (isRepetitionLoop(content)) {
          degenerated = true;
          ac.abort();
          break;
        }
        yield { type: "token", text: choice.delta.content };
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      if (chunk.usage) {
        usageIn += chunk.usage.prompt_tokens ?? 0;
        usageOut += chunk.usage.completion_tokens ?? 0;
        // A repetition-rewrite/compose request's prompt IS the current
        // context — this must update contextTokens too, not just the
        // main-loop site below, or a turn that ends via forcedTextAttempt
        // reports a stale/null context size.
        if (chunk.usage.prompt_tokens) contextTokens = chunk.usage.prompt_tokens;
      }
    }
    return { content, lengthCapped: finishReason === "length", degenerated };
  }

  for (let iter = 0; iter < max; iter++) {
    if (opts.signal?.aborted) break;
    const last = iter === max - 1;

    // Transient per-turn steering, never pushed onto msgs (not persisted, not
    // resent): the final forced-text turn gets the answer-now instruction; any
    // mid-loop turn after the first tool round gets the early-answer nudge.
    // pendingSteer (the promised-tool retry) outranks the positional steers: the
    // replay is iter > 0, and EARLY_ANSWER_NUDGE tells the model to answer
    // instead of calling more tools — the exact opposite of what this retry is
    // for. Consumed once, so the round after the replay steers normally again.
    const steer = pendingSteer ?? (last ? FINAL_TURN_INSTRUCTION : iter > 0 ? EARLY_ANSWER_NUDGE : null);
    pendingSteer = null;
    const turnMsgs: Msg[] = steer ? [...msgs, { role: "system", content: steer }] : msgs;

    // Per-round controller so a mid-stream repetition trip can abort the
    // provider call without treating the user's signal as cancelled.
    const roundAc = new AbortController();
    const roundSignal = opts.signal ? AbortSignal.any([opts.signal, roundAc.signal]) : roundAc.signal;
    const stream = opts.stream({
      messages: turnMsgs,
      tools: CHAT_TOOLS,
      toolChoice: last ? "none" : "auto",
      signal: roundSignal,
    });

    let content = "";
    let finishReason: string | null = null;
    let degenerated = false;
    const pending = new Map<number, PendingCall>();

    for await (const chunk of stream) {
      if (opts.signal?.aborted) break;
      // OpenRouter exposes the generation id as the chunk id (gen-…); the cost
      // reconciler later looks this up. Prefer it over the SDK header access.
      // NOTE: multi-round answers have one gen-id per round; we keep only the
      // last, so async cost backfill undercounts multi-round cost (v1 concern).
      if (typeof chunk.id === "string" && chunk.id.startsWith("gen-")) generationId = chunk.id;

      const choice = chunk.choices?.[0];
      const reasoning = reasoningDelta(choice?.delta);
      if (reasoning) yield { type: "reasoning", text: reasoning };
      if (choice?.delta?.content) {
        content += choice.delta.content;
        if (isRepetitionLoop(content)) {
          degenerated = true;
          roundAc.abort();
          break;
        }
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
        // Overwrite (not accumulate) — this is the real per-round context
        // size, and only the LAST round's value describes the context the
        // shipped answer was produced against.
        if (chunk.usage.prompt_tokens) contextTokens = chunk.usage.prompt_tokens;
      }
    }

    if (opts.signal?.aborted) break;

    // Repetition handbrake: wipe whatever streamed, rewrite once with no tools.
    // The bad draft never enters msgs. A second degeneration ships empty rather
    // than looping retries (same one-shot policy as the compose guard).
    if (degenerated) {
      captureEvent("chat_loop_repetition", opts.obs, { iter, chars: content.length });
      yield { type: "clear", reason: "degenerate" };
      const rewritten = yield* forcedTextAttempt(REPETITION_STEER);
      let finalContent = rewritten.content;
      let capped = rewritten.lengthCapped;
      if (rewritten.degenerated || isRepetitionLoop(finalContent)) {
        captureEvent("chat_loop_repetition_retry_failed", opts.obs, { chars: finalContent.length });
        yield { type: "clear", reason: "degenerate" };
        finalContent = "";
        capped = false;
      }
      yield {
        type: "done",
        content: finalContent,
        usage: { input: usageIn, output: usageOut },
        contextTokens,
        generationId,
        toolCalls,
        lengthCapped: capped,
        transcript: finalContent ? [...msgs, { role: "assistant", content: finalContent }] : [...msgs],
      };
      return;
    }

    // A tool round. Trust the accumulated `pending` map directly rather than
    // gating on finish_reason === "tool_calls": OpenRouter fans a tier out
    // across several providers (model-router.ts — gemma, glm, haiku, gpt-5-mini
    // as observed when this was diagnosed; the strong slot has since moved to
    // openai/gpt-5.6-luna, not re-checked for this same quirk — the pending-map
    // fallback below is deliberately provider-agnostic, so it doesn't need to be),
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
      if (content) yield { type: "clear", reason: "tool_round" };
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
      const skipExec = (name: string) => name === EXPORT_TOOL_NAME || name === ASK_EXTERNAL_MSC;
      const results = await Promise.all(
        parsedCalls.map((c) => (skipExec(c.name) ? Promise.resolve(null) : execToolDetailed(opts.ix, c.name, c.raw, opts.obs))),
      );
      const roundResults: RoundInfo["results"] = [];
      for (let i = 0; i < parsedCalls.length; i++) {
        const c = parsedCalls[i];

        // ── export_findings: build the artifact, hand the file to the client,
        // feed the model only a small ack (never the file body). ──────────────
        if (c.name === ASK_EXTERNAL_MSC) {
          const lastUser = [...msgs].reverse().find((m) => m.role === "user" && typeof m.content === "string");
          const userQ = opts.userQuestion ?? (typeof lastUser?.content === "string" ? lastUser.content : "");
          let payload: Record<string, unknown>;
          try {
            payload = await runAskExternalMsc(c.args, userQ, opts.jsonCall, opts.signal);
          } catch (e) {
            captureError(e, opts.obs, { tool: ASK_EXTERNAL_MSC });
            payload = { error: (e as Error).message };
          }
          const toolContent = JSON.stringify(payload);
          const ok = !isErrorResult(toolContent);
          toolCalls.push({ name: c.name, args: c.args, ok, bytes: toolContent.length });
          yield { type: "tool_result", name: c.name, ok, bytes: toolContent.length };
          msgs.push({ role: "tool", tool_call_id: c.id, content: toolContent });
          roundResults.push({ name: c.name, ok, content: toolContent, truncated: false });
          continue;
        }

        if (c.name === EXPORT_TOOL_NAME) {
          let ack: Record<string, unknown>;
          try {
            const art = buildExportArtifact(c.args as Parameters<typeof buildExportArtifact>[0]);
            // Deterministically verify the file body against this turn's evidence
            // (tool results + prior answers) BEFORE it downloads — the harness
            // only audits the chat answer, so an unchecked file could carry a
            // fabricated citation/quote/address. Withhold + tell the model to fix.
            const check = checkExportArtifact(art, exportEvidence(msgs), opts.ix);
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

    // Promised-tool guard (chat/announcement.ts): the round wrote an
    // announcement — "one moment while I search the atlas" — and called no
    // tool, so accepting it as the final answer ships a promise. Buy one more
    // round WITH tools instead. Deliberately narrow: only when the whole turn
    // has retrieved nothing (a turn that already searched has evidence, so its
    // prose is an answer), only when a round remains, and only once — a second
    // announcement ships as-is, the same one-shot policy the compose and
    // repetition guards use. Anything checkable in the text short-circuits
    // announcesUnmadeToolCall before the embedding, which is what keeps
    // features/glossary answers — legitimately tool-free — out of scope.
    if (
      !promisedToolRetried &&
      !last &&
      toolCalls.length === 0 &&
      !opts.signal?.aborted &&
      // A cut-off generation is a hard failure the orchestrator already reports
      // (lengthCapped); its truncated tail is not an announcement, and retrying
      // would swallow the signal.
      finishReason !== "length" &&
      announcesUnmadeToolCall(content)
    ) {
      promisedToolRetried = true;
      captureEvent("chat_loop_promised_tool", opts.obs, { iter, chars: content.length });
      // At iter === max - 2 the replay lands on `last`, where toolChoice is
      // "none" and the steer's "call the tool NOW" is unreachable. Not a bug and
      // not reachable at the default budget: the steer's second clause ("answer
      // it directly and completely instead") is what the model follows there,
      // and FINAL_TURN_INSTRUCTION already forbids describing further searches.
      // Same reason the client already understands: prose the model set aside
      // to go on searching. In staged mode nothing streamed, so this is a no-op
      // for the reader and the turn just spends one more round.
      yield { type: "clear", reason: "tool_round" };
      pendingSteer = PROMISED_TOOL_STEER;
      continue;
    }

    // Otherwise this streamed content is the final answer. If the round came
    // back EMPTY (not aborted), the compose guard buys exactly one more
    // no-tools attempt before the turn is allowed to end — an empty second
    // attempt ships as-is rather than retrying forever. A compose that itself
    // degenerates into a repetition loop is cleared the same way.
    let finalContent = content;
    let capped = finishReason === "length";
    if (!finalContent.trim() && !opts.signal?.aborted) {
      const composed = yield* forcedTextAttempt(COMPOSE_STEER);
      if (composed.degenerated || isRepetitionLoop(composed.content)) {
        captureEvent("chat_loop_repetition", opts.obs, { iter, chars: composed.content.length, stage: "compose" });
        yield { type: "clear", reason: "degenerate" };
        finalContent = "";
        capped = false;
      } else {
        finalContent = composed.content;
        capped = composed.lengthCapped;
      }
    }
    yield {
      type: "done",
      content: finalContent,
      usage: { input: usageIn, output: usageOut },
      contextTokens,
      generationId,
      toolCalls,
      lengthCapped: capped,
      transcript: finalContent ? [...msgs, { role: "assistant", content: finalContent }] : [...msgs],
    };
    return;
  }

  // Reached only if aborted, or maxIterations somehow exhausted without a text
  // answer. Emit a terminal event so callers can persist + close cleanly.
  yield { type: "done", content: "", usage: { input: usageIn, output: usageOut }, contextTokens, generationId, toolCalls, lengthCapped: false, transcript: [...msgs] };
}
