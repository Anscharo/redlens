// Conversation replay for /api/chat: what the model sees of the thread, and
// when a prefix of it is compacted away. The summarizer itself is one call in
// context-summary.ts; everything here except compactForReplay is pure.
//
// Every stored message is replayed in full. There is no per-message character
// cap. The only time older turns leave the prompt is when the replay itself
// is about to fill the model's context window: at 90% of
// config.chatContextWindowTokens (default 200k, the smallest model in the
// routing chain) the prefix is summarized once and replaced by that summary.
// The estimate can still be wrong in the unsafe direction, so a provider that
// rejects the request forces a compaction on the next turn — see context-overflow.ts.
//
// Prompt caches are sequential. A provider reuses a cached prefix only while
// every byte up to that point matches the previous request. So:
//   - between compactions the prompt only grows by append (new user message,
//     new lookup cards, new answer);
//   - compaction rewrites the prefix ONCE, summarizing a large chunk (everything
//     but a short tail) so the next many turns stay under the line and the
//     new summary is stable;
//   - lookup cards are not rebuilt on read (tool-recall.ts).
// The summary is its own user/assistant pair AFTER the system prompt, never
// spliced into the system prompt. The system prompt's volatile tail (date,
// page) already limits how far a cache hit can extend; changing the summary
// every turn would throw away the rest of the conversation on top of that.
import type OpenAI from "openai";
import type { JsonCall } from "./llm.ts";
import { summarizePrefix, SUMMARY_MAX_CHARS } from "./context-summary.ts";
import { convFlags } from "./conv-flags.ts";
import { replayArguments, type RecallToolCall } from "./tool-recall-card.ts";
import { reviewRound } from "./review-round.ts";
import type { ReviewNote } from "./verify/review-note.ts";

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export const COMPACT_RATIO = 0.9;
/** User + assistant rows left verbatim. Three exchanges, plus the question being answered when it falls inside the suffix. */
export const COMPACT_TAIL = 6;
/**
 * Tail kept by a FORCED compaction (the provider already rejected this thread's
 * length, context-overflow.ts). The estimate below has been proven wrong on
 * this conversation, so a forced compaction does not trust it a second time: it
 * keeps the shortest useful tail — the question being answered and the
 * exchange before it — and summarizes everything else.
 */
export const COMPACT_TAIL_FORCED = 2;
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
/** Share of the window one summarization call may read, so compacting cannot itself overflow. */
const SUMMARY_INPUT_RATIO = 0.7;

export interface ReplayRow {
  id?: string;
  role: string;
  content: string;
  toolCalls?: RecallToolCall[] | null;
  /**
   * The check results the USER saw under this answer (verify/review-note.ts).
   * Purely additive and deliberately NOT read by historyReplay or rowPart: the
   * history prefix stays byte-identical with or without it, and the summarizer
   * never sees it. It reaches the model only through review-round.ts's one tail
   * round, which is why `replayTokens` below has to count it separately.
   */
  review?: ReviewNote | null;
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

export function summaryReplay(summary: string): Msg[] {
  return [
    { role: "user", content: `${SUMMARY_LEAD}\n\n${summary}` },
    { role: "assistant", content: SUMMARY_ACK },
  ];
}

function callsWithRecall(row: ReplayRow): RecallToolCall[] {
  // Array-check, not just a null-check: this reads a jsonb column. Written the
  // way persistAssistant writes it (a raw array + ::jsonb) it comes back
  // parsed, but a double-encoded value — `JSON.stringify` through the same cast
  // — comes back as a STRING, and .filter on that throws. Replay runs on the
  // chat turn AND, since the context meter, on the conversation-detail read, so
  // one malformed legacy row would take out reopening that chat rather than
  // just losing its cards.
  if (!Array.isArray(row.toolCalls)) return [];
  return row.toolCalls.filter((t) => t && t.recall && t.recall_id);
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
  // The review round is real context the turn is sent, so it is counted here and
  // not anywhere else: contextUsedTokens, needsCompaction and planWithinLine all
  // route through this one function, which is what keeps the meter, the 90%
  // trigger and the tail sizing a single quantity.
  const msgs = [...(summary ? summaryReplay(summary) : []), ...historyReplay(rows), ...reviewRound(rows)];
  const chars = msgs.reduce((s, m) => s + messageChars(m), 0);
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/**
 * What a turn that reads this conversation costs: the replay it starts from,
 * plus the standing prefix it is always sent with.
 *
 * This is the number the UI meters, and `needsCompaction` is this same number
 * compared against 90% of the window — deliberately one function, because the
 * two used to be different quantities and the meter could therefore disagree
 * with when a compaction actually fired. It is NOT the measured `prompt_tokens` of a
 * past round: that counts one turn's tool results, which the next turn never
 * replays (they come back as ~1.8k lookup cards), so a tool-heavy turn measured
 * far above what the conversation actually carries and the meter fell back on
 * the following turn. Cost and rate limiting still use the measured value;
 * "how full is this conversation" is this one.
 */
export function contextUsedTokens(
  summary: string | null,
  rows: ReplayRow[],
  overheadTokens = CONTEXT_OVERHEAD_TOKENS,
): number {
  return replayTokens(summary, rows) + overheadTokens;
}

export function needsCompaction(
  summary: string | null,
  rows: ReplayRow[],
  windowTokens: number,
  overheadTokens = CONTEXT_OVERHEAD_TOKENS,
): boolean {
  if (rows.length <= COMPACT_TAIL) return false;
  return contextUsedTokens(summary, rows, overheadTokens) >= windowTokens * COMPACT_RATIO;
}

export interface CompactionPlan {
  prefix: ReplayRow[];
  tail: ReplayRow[];
  uptoId: string;
}

/**
 * Summarize everything before a verbatim suffix. The suffix is the cache-stable
 * tail: after this runs, later turns only append. Returns null when there is
 * nothing with an id to point summary_upto_id at (evals, tests, a tail-only
 * thread). The current user message is the last row and stays in the tail.
 */
export function planCompaction(rows: ReplayRow[], tailCount = COMPACT_TAIL): CompactionPlan | null {
  if (rows.length <= tailCount) return null;
  const prefix = rows.slice(0, rows.length - tailCount);
  const tail = rows.slice(rows.length - tailCount);
  // The cursor is the last compacted row. An earlier id would summarize rows
  // the next turn also replays, and a missing id would hide them.
  const uptoId = prefix[prefix.length - 1]?.id;
  if (!uptoId) return null;
  return { prefix, tail, uptoId };
}

/**
 * The plan whose verbatim tail is itself under the line, shrinking the tail a
 * row at a time from `tailCount` down to the current user message alone.
 *
 * A tail of ordinary rows is nowhere near the line, so this returns
 * `planCompaction(rows, tailCount)` on the first try for every real
 * conversation. It exists for the one case that a compaction otherwise cannot
 * rescue: six rows that are themselves most of the window (a user may send
 * MAX_MESSAGE_BYTES per message, and one assistant row can carry several
 * lookup cards). Compacting "everything but six rows" there produces a prompt
 * that is still over the line, which the provider rejects and no further compaction
 * can fix. The summary that replaces the prefix is counted at its cap, since
 * its real length is not known until the model has written it.
 */
function planWithinLine(
  rows: ReplayRow[],
  tailCount: number,
  windowTokens: number,
  overheadTokens: number,
): CompactionPlan | null {
  const summaryTokens = Math.ceil(SUMMARY_MAX_CHARS / CHARS_PER_TOKEN);
  for (let n = tailCount; n >= 1; n--) {
    const plan = planCompaction(rows, n);
    if (!plan) continue; // fewer tail rows may still leave a compactable prefix
    const tailTokens = replayTokens(null, plan.tail) + summaryTokens + overheadTokens;
    if (tailTokens < windowTokens * COMPACT_RATIO || n === 1) return plan;
  }
  return null;
}

/** Drop rows already compacted into the stored summary. Unknown cursor → replay everything (do not hide the thread). */
export function rowsAfterCursor(rows: ReplayRow[], uptoId: string | null | undefined): ReplayRow[] {
  if (!uptoId) return rows;
  const i = rows.findIndex((r) => r.id === uptoId);
  if (i === -1) return rows;
  return rows.slice(i + 1);
}

export interface CompactInput {
  rows: ReplayRow[];
  summary: string | null;
  windowTokens: number;
  overheadTokens?: number;
  call: JsonCall;
  model: string;
  timeoutMs: number;
  /**
   * Compact even though the estimate says the thread fits, keeping
   * COMPACT_TAIL_FORCED rows. Set when the provider rejected this
   * conversation for length (context-overflow.ts).
   */
  force?: boolean;
}

/**
 * A compaction either happened — and then there is a summary AND a cursor to store
 * it against — or it did not. Saying that in the type means the caller writes
 * `if (result.compacted)` instead of re-checking `uptoId` to find out whether
 * a null cursor is a state it has to handle.
 *
 * `failed` marks a summary call that ran and produced nothing (timeout, error,
 * unparseable output). The full rows are still returned; the caller backs off
 * so the next turn does not pay the timeout again.
 */
export type CompactResult =
  | { compacted: true; rows: ReplayRow[]; summary: string; uptoId: string; failed: false }
  | { compacted: false; rows: ReplayRow[]; summary: string | null; uptoId: null; failed: boolean };

/**
 * How long chat.ts skips another summary after `failed`. A provider outage
 * must not add chatSummaryTimeoutMs of dead air to every later turn of a
 * thread that is still over the line. In-memory and per process: a restart
 * retries on the next turn, which is the right time to try again.
 */
export const SUMMARY_FAILURE_COOLDOWN_MS = 5 * 60_000;

const summaryFailed = convFlags(SUMMARY_FAILURE_COOLDOWN_MS);

export function summaryCoolingDown(convId: string, now = Date.now()): boolean {
  return summaryFailed.has(convId, now);
}

export function noteSummaryFailure(convId: string, now = Date.now()): void {
  summaryFailed.set(convId, now);
}

export function clearSummaryFailure(convId: string): void {
  summaryFailed.clear(convId);
}

/**
 * Compact when the replay is at 90% of the window, or whenever `force` is set.
 * On any failure (timeout, empty model, unparseable summary) the full rows are
 * returned unchanged — a missed compaction degrades to a large prompt, never a
 * dropped thread. `failed` is set only when a summary call was actually
 * attempted.
 */
export async function compactForReplay(input: CompactInput): Promise<CompactResult> {
  const { rows, summary, windowTokens, call, model, timeoutMs, force } = input;
  const overhead = input.overheadTokens ?? CONTEXT_OVERHEAD_TOKENS;
  const unchanged = { rows, summary, uptoId: null, compacted: false as const, failed: false };
  if (!model) return unchanged;
  if (!force && !needsCompaction(summary, rows, windowTokens, overhead)) return unchanged;
  const plan = planWithinLine(rows, force ? COMPACT_TAIL_FORCED : COMPACT_TAIL, windowTokens, overhead);
  if (!plan) return unchanged;
  const budget = Math.floor(windowTokens * SUMMARY_INPUT_RATIO * CHARS_PER_TOKEN);
  try {
    const next = await summarizePrefix(summary, plan.prefix, call, model, budget, timeoutMs);
    if (!next) return { ...unchanged, failed: true };
    return { rows: plan.tail, summary: next, uptoId: plan.uptoId, compacted: true, failed: false };
  } catch {
    return { ...unchanged, failed: true };
  }
}
