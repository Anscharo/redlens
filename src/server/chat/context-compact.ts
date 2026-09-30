// Conversation replay for /api/chat.
//
// Every stored message is replayed in full. There is no per-message character
// cap. The only time older turns leave the prompt is when the replay itself
// is about to fill the model's context window: at 90% of
// config.chatContextWindowTokens (default 200k, the smallest model in the
// routing chain) the prefix is summarized once and replaced by that summary.
//
// Prompt caches are sequential. A provider reuses a cached prefix only while
// every byte up to that point matches the previous request. So:
//   - between compactions the prompt only grows by append (new user message,
//     new lookup cards, new answer);
//   - compaction rewrites the prefix ONCE, folding a large chunk (everything
//     but a short tail) so the next many turns stay under the line and the
//     new summary is stable;
//   - lookup cards are not rebuilt on read (tool-recall.ts).
// The summary is its own user/assistant pair AFTER the system prompt, never
// spliced into the system prompt. The system prompt's volatile tail (date,
// page) already limits how far a cache hit can extend; changing the summary
// every turn would throw away the rest of the conversation on top of that.
import type OpenAI from "openai";
import { callWithTimeout, type JsonCall } from "./llm.ts";
import { replayArguments, type RecallToolCall } from "./tool-recall.ts";

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export const COMPACT_RATIO = 0.9;
/** User + assistant rows left verbatim. Three exchanges, plus the question being answered when it falls inside the suffix. */
export const COMPACT_TAIL = 6;
// Prose and the tool schemas both land near 4 chars/token. A measured
// gpt-5.6-luna turn (trace 0e97e0a6, 2026-09-21) was 18,976 input tokens for
// 44,728 chars of messages plus 41,712 chars of tool definitions — about 4.6
// chars/token together. The raw tokens/message-chars ratio was 2.4 only
// because the schemas are in the token count and not in the message chars.
// Do not lower this to 2.4; that would compact a thread that still fits.
export const CHARS_PER_TOKEN = 4;
/**
 * Tool schemas (~11k tokens, see llm.ts sessionParam) plus the system prompt.
 * Counted toward the 90% line so history alone cannot fill the window before
 * the standing prefix is included.
 */
export const CONTEXT_OVERHEAD_TOKENS = 20_000;
/** A stored summary is capped so the card that replaces the prefix cannot itself sit on the compaction line. */
const SUMMARY_MAX_CHARS = 12_000;
const SUMMARY_INPUT_RATIO = 0.7;

export interface ReplayRow {
  id?: string;
  role: string;
  content: string;
  toolCalls?: RecallToolCall[] | null;
}

/**
 * Fixed acknowledgement. priorTurnsEvidence skips this exact string so the
 * verifier does not treat the compaction handshake as an earlier answer.
 * Changing it busts the cache of every conversation that already has a summary.
 */
export const SUMMARY_ACK =
  "Understood. I will treat that as the earlier conversation and continue from the messages after it.";

const SUMMARY_LEAD =
  "Earlier conversation, summarized so this thread can continue. This is what was asked, answered, and looked up. It is not atlas text. Do not answer this message; the conversation continues after it.";

const SUMMARY_SYSTEM = [
  "You compact a governance-research chat so a later turn can continue it.",
  "Preserve the user's questions, the conclusions reached, atlas document UUIDs, doc numbers, titles, addresses, numbers and thresholds, unresolved questions, and the lookup handles in any tool-recall notes (tool name and ids).",
  "Do not invent documents or figures that are not in the transcript.",
  "Write a dense briefing, not a transcript. At most 900 words.",
  'Respond with STRICT JSON only: {"summary":"…"}',
].join("\n");

export function summaryReplay(summary: string): Msg[] {
  return [
    { role: "user", content: `${SUMMARY_LEAD}\n\n${summary}` },
    { role: "assistant", content: SUMMARY_ACK },
  ];
}

function callsWithRecall(row: ReplayRow): RecallToolCall[] {
  return (row.toolCalls ?? []).filter((t) => t.recall && t.recall_id);
}

/** Stored rows → the messages the model actually sees. No truncation. */
export function historyReplay(rows: ReplayRow[]): Msg[] {
  const out: Msg[] = [];
  for (const row of rows) {
    const recalled = row.role === "assistant" ? callsWithRecall(row) : [];
    if (recalled.length > 0) {
      out.push({
        role: "assistant",
        content: null,
        tool_calls: recalled.map((t) => ({
          id: t.recall_id!,
          type: "function" as const,
          function: { name: t.name, arguments: replayArguments(t.args) },
        })),
      });
      for (const t of recalled) {
        out.push({ role: "tool", tool_call_id: t.recall_id!, content: t.recall! });
      }
    }
    if (row.content.trim() !== "") {
      out.push({ role: row.role as "user" | "assistant", content: row.content });
    }
  }
  return out;
}

function messageChars(m: Msg): number {
  let n = typeof m.content === "string" ? m.content.length : 0;
  if (m.role === "assistant" && Array.isArray(m.tool_calls)) {
    for (const tc of m.tool_calls) {
      if (tc.type === "function") n += tc.function.name.length + tc.function.arguments.length;
    }
  }
  return n;
}

export function replayTokens(summary: string | null, rows: ReplayRow[]): number {
  const msgs = [...(summary ? summaryReplay(summary) : []), ...historyReplay(rows)];
  const chars = msgs.reduce((s, m) => s + messageChars(m), 0);
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

export function needsCompaction(
  summary: string | null,
  rows: ReplayRow[],
  windowTokens: number,
  overheadTokens = CONTEXT_OVERHEAD_TOKENS,
): boolean {
  if (rows.length <= COMPACT_TAIL) return false;
  return replayTokens(summary, rows) + overheadTokens >= windowTokens * COMPACT_RATIO;
}

export interface CompactionPlan {
  fold: ReplayRow[];
  tail: ReplayRow[];
  uptoId: string;
}

/**
 * Fold everything before a verbatim suffix. The suffix is the cache-stable
 * tail: after this runs, later turns only append. Returns null when there is
 * nothing with an id to point summary_upto_id at (evals, tests, a tail-only
 * thread). The current user message is the last row and stays in the tail.
 */
export function planCompaction(rows: ReplayRow[], tailCount = COMPACT_TAIL): CompactionPlan | null {
  if (rows.length <= tailCount) return null;
  const fold = rows.slice(0, rows.length - tailCount);
  const tail = rows.slice(rows.length - tailCount);
  // The cursor is the last folded row. An earlier id would summarize rows
  // the next turn also replays, and a missing id would hide them.
  const uptoId = fold[fold.length - 1]?.id;
  if (!uptoId) return null;
  return { fold, tail, uptoId };
}

/** Drop rows already folded into the stored summary. Unknown cursor → replay everything (do not hide the thread). */
export function rowsAfterCursor(rows: ReplayRow[], uptoId: string | null | undefined): ReplayRow[] {
  if (!uptoId) return rows;
  const i = rows.findIndex((r) => r.id === uptoId);
  if (i === -1) return rows;
  return rows.slice(i + 1);
}

export function renderFold(summary: string | null, rows: ReplayRow[]): string {
  const parts: string[] = [];
  if (summary?.trim()) parts.push(`Previous summary:\n${summary.trim()}`);
  for (const row of rows) {
    const recalls = (row.toolCalls ?? []).map((t) => t.recall).filter((s): s is string => !!s && s.trim() !== "");
    const body = [row.content, ...recalls].filter((s) => s.trim() !== "").join("\n");
    if (body.trim()) parts.push(`${row.role}:\n${body}`);
  }
  return parts.join("\n\n");
}

export function parseSummary(raw: string): string | null {
  const stripped = raw.replace(/```(?:json)?/g, "").trim();
  try {
    const parsed = JSON.parse(stripped) as { summary?: unknown };
    if (parsed && typeof parsed === "object" && typeof parsed.summary === "string" && parsed.summary.trim()) {
      return parsed.summary.trim().slice(0, SUMMARY_MAX_CHARS);
    }
  } catch {
    // Prose fallback below.
  }
  const text = stripped.trim();
  if (text.length < 40) return null;
  return text.slice(0, SUMMARY_MAX_CHARS);
}

async function summarizeChunk(call: JsonCall, model: string, text: string, timeoutMs: number): Promise<string | null> {
  const res = await callWithTimeout(
    call,
    {
      model,
      messages: [
        { role: "system", content: SUMMARY_SYSTEM },
        { role: "user", content: text },
      ],
      maxTokens: 2048,
    },
    timeoutMs,
  );
  return parseSummary(res.text);
}

/**
 * Summarize `fold`, folding any existing summary in. One call when the prefix
 * fits; otherwise oldest-first chunks, each chunk's summary becoming the prior
 * for the next, so a single compaction still ends as one stable summary.
 */
export async function summarizeFold(
  summary: string | null,
  fold: ReplayRow[],
  call: JsonCall,
  model: string,
  windowTokens: number,
  timeoutMs: number,
): Promise<string | null> {
  const budget = Math.floor(windowTokens * SUMMARY_INPUT_RATIO * CHARS_PER_TOKEN);
  let prior = summary;
  let pending = fold;
  let produced: string | null = null;
  while (pending.length > 0) {
    let take = 1;
    while (take < pending.length && renderFold(prior, pending.slice(0, take + 1)).length <= budget) take++;
    const chunk = pending.slice(0, take);
    pending = pending.slice(take);
    let text = renderFold(prior, chunk);
    if (text.length > budget) text = text.slice(0, budget);
    const next = await summarizeChunk(call, model, text, timeoutMs);
    if (!next) return null;
    prior = next;
    produced = next;
  }
  return produced;
}

export interface CompactInput {
  rows: ReplayRow[];
  summary: string | null;
  windowTokens: number;
  overheadTokens?: number;
  call: JsonCall;
  model: string;
  timeoutMs: number;
}

export interface CompactResult {
  rows: ReplayRow[];
  summary: string | null;
  uptoId: string | null;
  compacted: boolean;
  /**
   * A summary call ran and produced nothing (timeout, error, unparseable
   * output). The full rows are still returned. The caller should back off
   * so the next turn does not pay the timeout again.
   */
  failed: boolean;
}

/**
 * How long chat.ts skips another summary after `failed`. A provider outage
 * must not add chatSummaryTimeoutMs of dead air to every later turn of a
 * thread that is still over the line. In-memory and per process: a restart
 * retries on the next turn, which is the right time to try again.
 */
export const SUMMARY_FAILURE_COOLDOWN_MS = 5 * 60_000;

const summaryRetryAt = new Map<string, number>();

export function summaryCoolingDown(convId: string, now = Date.now()): boolean {
  const until = summaryRetryAt.get(convId);
  if (until == null) return false;
  if (now >= until) {
    summaryRetryAt.delete(convId);
    return false;
  }
  return true;
}

export function noteSummaryFailure(convId: string, now = Date.now()): void {
  summaryRetryAt.set(convId, now + SUMMARY_FAILURE_COOLDOWN_MS);
}

export function clearSummaryFailure(convId: string): void {
  summaryRetryAt.delete(convId);
}

/**
 * Compact when the replay is at 90% of the window. On any failure (timeout,
 * empty model, unparseable summary) the full rows are returned unchanged —
 * a missed compaction degrades to a large prompt, never a dropped thread.
 * `failed` is set only when a summary call was actually attempted.
 */
export async function compactForReplay(input: CompactInput): Promise<CompactResult> {
  const { rows, summary, windowTokens, call, model, timeoutMs } = input;
  const overhead = input.overheadTokens ?? CONTEXT_OVERHEAD_TOKENS;
  const unchanged: CompactResult = { rows, summary, uptoId: null, compacted: false, failed: false };
  if (!model) return unchanged;
  if (!needsCompaction(summary, rows, windowTokens, overhead)) return unchanged;
  const plan = planCompaction(rows);
  if (!plan) return unchanged;
  try {
    const next = await summarizeFold(summary, plan.fold, call, model, windowTokens, timeoutMs);
    if (!next) return { ...unchanged, failed: true };
    return { rows: plan.tail, summary: next, uptoId: plan.uptoId, compacted: true, failed: false };
  } catch {
    return { ...unchanged, failed: true };
  }
}
