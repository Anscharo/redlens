// A tool round: the assistant turn that carried tool calls is recorded, every
// call runs, and each result is yielded to the client and appended to the
// transcript in call order.
import { execToolDetailed, safeParseArgs } from "../tools/llm-tools.ts";
import { EXPORT_TOOL_NAME, buildExportArtifact, redactExportArgs } from "../tools/export-tool.ts";
import { checkExportArtifact } from "../tools/export-verify.ts";
import { ASK_EXTERNAL_MSC, runAskExternalMsc } from "../tools/external-tools.ts";
import { captureError, captureEvent } from "../../posthog-node.ts";
import { exportEvidence } from "./export-evidence.ts";
import type { ChatEvent, LoopCtx, PendingCall, RoundInfo, RoundOutput } from "./types.ts";

type ParsedCall = { id: string; name: string; raw: string; args: Record<string, unknown> };
type RoundResult = RoundInfo["results"][number];
type ToolSize = { bytes: number; truncated: boolean; originalBytes?: number };

// The tool-result wire format for a failed call (see llm-tools.ts). Shared
// with round-checks.ts so the UI's per-call ok badge and the harness's
// errorResults telemetry can never disagree about what counts as an error.
export function isErrorResult(content: string): boolean {
  return content.startsWith('{"error"');
}

// A pending slot can be unusable — empty/missing id or name — if a stream
// is cut short or a provider emits a malformed delta for an index that
// never receives its function name. There is no tool to call and no id to
// attach a "tool" result message to, so such slots are filtered out before
// execution rather than sent to execToolDetailed. If that empties the round
// entirely, the caller falls through to the plain-answer path exactly as if
// no tool_calls had streamed at all.
export function usableCalls(ctx: LoopCtx, iter: number, round: RoundOutput): PendingCall[] {
  const rawCalls = [...round.pending.values()];
  const calls = rawCalls.filter((c) => c.id && c.name);
  if (calls.length < rawCalls.length) {
    captureEvent("chat_loop_malformed_tool_call", ctx.opts.obs, {
      iter,
      dropped: rawCalls.length - calls.length,
      finishReason: round.finishReason,
    });
  }
  return calls;
}

// Records the result on the turn's tool-call list, tells the client, and
// appends the tool message the next request replays — in that order.
function* deliver(ctx: LoopCtx, c: ParsedCall, content: string, size: ToolSize): Generator<ChatEvent, RoundResult> {
  const ok = !isErrorResult(content);
  const extra = size.truncated ? { truncated: true, originalBytes: size.originalBytes } : {};
  ctx.toolCalls.push({ name: c.name, args: c.args, ok, bytes: size.bytes, ...extra });
  yield { type: "tool_result", name: c.name, ok, bytes: size.bytes, ...extra };
  ctx.msgs.push({ role: "tool", tool_call_id: c.id, content });
  return { name: c.name, ok, content, truncated: size.truncated };
}

async function externalMscContent(ctx: LoopCtx, c: ParsedCall): Promise<string> {
  const lastUser = [...ctx.msgs].reverse().find((m) => m.role === "user" && typeof m.content === "string");
  const userQ = ctx.opts.userQuestion ?? (typeof lastUser?.content === "string" ? lastUser.content : "");
  let payload: Record<string, unknown>;
  try {
    payload = await runAskExternalMsc(c.args, userQ, ctx.opts.jsonCall, ctx.opts.signal);
  } catch (e) {
    captureError(e, ctx.opts.obs, { tool: ASK_EXTERNAL_MSC });
    payload = { error: (e as Error).message };
  }
  return JSON.stringify(payload);
}

// export_findings: build the artifact, hand the file to the client, feed the
// model only a small ack (never the file body). The file body is verified
// deterministically against this turn's evidence (tool results + prior
// answers) BEFORE it downloads — the harness only audits the chat answer, so
// an unchecked file could carry a fabricated citation/quote/address. A failed
// check withholds the file and tells the model what to fix.
function* exportAck(ctx: LoopCtx, c: ParsedCall): Generator<ChatEvent, string> {
  let ack: Record<string, unknown>;
  try {
    const art = buildExportArtifact(c.args as Parameters<typeof buildExportArtifact>[0]);
    const check = checkExportArtifact(art, exportEvidence(ctx.msgs), ctx.opts.ix);
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
  return JSON.stringify(ack);
}

type ExecResult = Awaited<ReturnType<typeof execToolDetailed>>;

async function* resolveCall(ctx: LoopCtx, c: ParsedCall, result: ExecResult | null): AsyncGenerator<ChatEvent, RoundResult> {
  if (c.name === ASK_EXTERNAL_MSC) {
    const content = await externalMscContent(ctx, c);
    return yield* deliver(ctx, c, content, { bytes: content.length, truncated: false });
  }
  if (c.name === EXPORT_TOOL_NAME) {
    const ack = yield* exportAck(ctx, c);
    return yield* deliver(ctx, c, ack, { bytes: ack.length, truncated: false });
  }
  const r = result!;
  return yield* deliver(ctx, c, r.content, { bytes: r.returnedChars, truncated: r.truncated, originalBytes: r.originalChars });
}

function recordAssistantRound(ctx: LoopCtx, content: string, calls: PendingCall[]): void {
  ctx.msgs.push({
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
}

function notifyRoundEnd(ctx: LoopCtx, iter: number, parsedCalls: ParsedCall[], results: RoundResult[]): void {
  try {
    ctx.opts.onRoundEnd?.({ iter, calls: parsedCalls.map((c) => ({ name: c.name, args: c.args })), results });
  } catch (err) {
    // Observer errors must never break the loop, but are still worth knowing about.
    captureError(err, ctx.opts.obs, { stage: "on_round_end_observer" });
  }
}

const skipExec = (name: string) => name === EXPORT_TOOL_NAME || name === ASK_EXTERNAL_MSC;

export async function* runToolRound(ctx: LoopCtx, iter: number, content: string, calls: PendingCall[]): AsyncGenerator<ChatEvent> {
  // This round's streamed content was pre-tool noise — tell the client to drop it.
  if (content) yield { type: "clear", reason: "tool_round" };
  recordAssistantRound(ctx, content, calls);
  const parsedCalls = calls.map((c) => ({ id: c.id, name: c.name, raw: c.args, args: safeParseArgs(c.args) }));
  for (const c of parsedCalls) yield { type: "tool_call", name: c.name, args: c.args };
  const results = await Promise.all(
    parsedCalls.map((c) => (skipExec(c.name) ? Promise.resolve(null) : execToolDetailed(ctx.opts.ix, c.name, c.raw, ctx.opts.obs))),
  );
  const roundResults: RoundResult[] = [];
  for (let i = 0; i < parsedCalls.length; i++) roundResults.push(yield* resolveCall(ctx, parsedCalls[i], results[i]));
  notifyRoundEnd(ctx, iter, parsedCalls, roundResults);
}
