// Persists a finished answer (never partial content): the assistant row, check
// rows, the usage_events ledger, conversation totals, and the title.
import { sql } from "../../db.ts";
import { captureError, type ErrorContext } from "../../posthog-node.ts";
import { attachRecall } from "../tool-recall.ts";
import type { HarnessDone, CheckRowMeta } from "../chat-orchestrator.ts";
import { titleConversation, buildTitleTranscript } from "../title.ts";
import type { ChatTurn } from "./turn.ts";

// Harness tokens count toward totals and quota, never the messages row, so sums don't double-count.
function usageTotals(done: HarnessDone): { usageInput: number; usageOutput: number } {
  const checkIn = (done.checksMeta ?? []).reduce((s, c) => s + (c.inputTokens ?? 0), 0);
  const checkOut = (done.checksMeta ?? []).reduce((s, c) => s + (c.outputTokens ?? 0), 0);
  return { usageInput: done.usage.input + checkIn, usageOutput: done.usage.output + checkOut };
}

// Runs concurrently with, and independent of, the messages insert: the client
// can delete the conversation mid-stream, and quota must still be counted. A
// failed FK insert retries with a null conversation_id (see migration 017).
function recordUsageEvent(
  userId: string, convId: string, totals: { usageInput: number; usageOutput: number }, obs?: ErrorContext,
): Promise<unknown> {
  const insertUsageEvent = (conversationId: string | null) => sql`
    INSERT INTO usage_events (user_id, conversation_id, input_tokens, output_tokens)
    VALUES (${userId}, ${conversationId}, ${totals.usageInput}, ${totals.usageOutput})
  `;
  return insertUsageEvent(convId).catch((err) => {
    captureError(err, obs, { stage: "usage_events_insert", conversationId: convId });
    return insertUsageEvent(null);
  });
}

async function persistChecks(messageId: string, rows: CheckRowMeta[]): Promise<void> {
  await Promise.all(
    rows.map(
      (r) => sql`
        INSERT INTO message_checks (message_id, kind, model, action, verdict, overall, input_tokens, output_tokens, generation_id, latency_ms)
        VALUES (${messageId}, ${r.kind}, ${r.model}, ${null}, ${r.verdict ?? null}::jsonb, ${r.overall},
                ${r.inputTokens}, ${r.outputTokens}, ${r.generationId}, ${r.latencyMs})
      `,
    ),
  );
}

// Raw array + ::jsonb (see resolveConversation's note) — not JSON.stringify'd.
async function insertAssistantRow(convId: string, done: HarnessDone, toolCalls: unknown, latencyMs: number): Promise<{ id: string }[]> {
  return (await sql`
      INSERT INTO messages (conversation_id, role, content, tool_calls, input_tokens, output_tokens, context_tokens, generation_id, latency_ms)
      VALUES (${convId}, 'assistant', ${done.content}, ${toolCalls}::jsonb,
              ${done.usage.input}, ${done.usage.output}, ${done.contextTokens ?? null}, ${done.generationId}, ${latencyMs})
      RETURNING id
    `) as { id: string }[];
}

// Independent writes, run concurrently. A persistChecks failure is logged
// only: the answer is already stored and delivered.
async function settleWrites(
  convId: string, messageId: string, done: HarnessDone, totals: { usageInput: number; usageOutput: number },
  usageEventDone: Promise<unknown>, obs?: ErrorContext,
): Promise<void> {
  await Promise.all([
    usageEventDone,
    persistChecks(messageId, done.checksMeta ?? []).catch((err) => {
      captureError(err, obs, { stage: "persist_checks" });
    }),
    sql`
      UPDATE conversations
      SET total_input_tokens = total_input_tokens + ${totals.usageInput},
          total_output_tokens = total_output_tokens + ${totals.usageOutput},
          query_atlas_calls = query_atlas_calls + ${done.toolCalls.length},
          updated_at = now()
      WHERE id = ${convId}
    `,
  ]);
}

// Re-exported from chat.ts for direct unit testing.
export async function persistAssistant(
  userId: string, convId: string, done: HarnessDone, latencyMs: number, obs?: ErrorContext,
): Promise<void> {
  // Lookup cards are computed once, here, from this turn's full tool results,
  // and stored on the row. Later turns replay the card, not the raw payload.
  const toolCalls = done.toolCalls.length ? attachRecall(done.toolCalls, done.transcript) : null;
  const totals = usageTotals(done);
  const usageEventDone = recordUsageEvent(userId, convId, totals, obs);
  let inserted: { id: string }[];
  try {
    inserted = await insertAssistantRow(convId, done, toolCalls, latencyMs);
  } catch (err) {
    // Conversation deleted mid-turn; quota accounting is still awaited.
    captureError(err, obs, { stage: "persist_assistant_message", conversationId: convId });
    await usageEventDone;
    return;
  }
  await settleWrites(convId, inserted[0].id, done, totals, usageEventDone, obs);
}

// Unawaited + .catch()'d. Deliberately NOT passed req.signal: the SSE response
// is already closing, so titling would silently no-op (see title.ts).
const TITLE_AT_TURNS = new Set([1, 4, 10]);
export function titleIfDue(t: ChatTurn, answer: string): void {
  if (!TITLE_AT_TURNS.has(t.priorAssistants + 1)) return;
  void titleConversation(t.convId, buildTitleTranscript(t.history, answer), t.obs).catch((err) =>
    captureError(err, t.obs, { stage: "title" }),
  );
}
