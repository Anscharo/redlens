// Persisting a finished answer: the assistant row, its check rows, the
// usage_events ledger row and the conversation totals — plus the conversation
// title, which is (re)written after the answer is stored. Runs AFTER the
// stream completes — never partial content.
import { sql } from "../../db.ts";
import { captureError, type ErrorContext } from "../../posthog-node.ts";
import { attachRecall } from "../tool-recall.ts";
import type { HarnessDone, CheckRowMeta } from "../chat-orchestrator.ts";
import { titleConversation, buildTitleTranscript } from "../title.ts";
import type { ChatTurn } from "./turn.ts";

// Harness (verifier) tokens count toward the conversation totals and
// the rate-limit window (via the usage_events row) — never toward the
// messages row, which stays conversationalist-only so the sums don't
// double-count.
function usageTotals(done: HarnessDone): { usageInput: number; usageOutput: number } {
  const checkIn = (done.checksMeta ?? []).reduce((s, c) => s + (c.inputTokens ?? 0), 0);
  const checkOut = (done.checksMeta ?? []).reduce((s, c) => s + (c.outputTokens ?? 0), 0);
  return { usageInput: done.usage.input + checkIn, usageOutput: done.usage.output + checkOut };
}

// Fired concurrently with the messages insert, not awaited by the caller yet —
// the two are mutually independent (usage_events doesn't need the message
// row's id, and quota accounting must be attempted regardless of whether
// the message insert itself succeeds), so serializing them would add a
// full extra DB round trip to every turn's tail latency for no benefit.
//
// The `meta` SSE event ships convId back to the client before any model
// work starts, so a client can DELETE /api/chat/conversations/:id while this
// turn is still streaming — by the time this runs, the conversation row may
// already be gone. messages.conversation_id is NOT NULL + ON DELETE CASCADE,
// so inserting against a deleted conversation FK-fails; if usage_events were
// only written after that insert succeeded, a well-timed delete would skip
// quota accounting entirely — the same reclaim-by-delete hole migration 017
// closes, relocated into this race window instead of the cascade.
// usage_events.conversation_id is nullable (ON DELETE SET NULL, provenance
// only — see migration 017) precisely so this can degrade to an
// orphaned-but-counted row instead of failing outright.
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

// The checks rows and the conversations totals update are independent
// writes (neither depends on the other's result, nor on the still-in-flight
// usage_events write) — run all three concurrently instead of stacking
// round trips on the client's already-completed answer. persistChecks
// degrades to a logged no-op on failure (e.g. a boot-time race against the
// message_checks migration): the assistant message is already durably
// persisted, so a telemetry-row failure must never surface as a turn-level
// error to a client that already has the complete answer.
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

// Exported (re-exported from chat.ts) for direct unit testing — constructing
// a full HarnessDone via the real HTTP+streaming+harness path just to exercise
// the usage_events summation would require standing up the verifier network
// flow; this function's persistence logic is worth testing directly instead.
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
    // Conversation deleted mid-turn: there's nowhere left to save the answer
    // or bump conversation totals. Still wait for quota accounting to land —
    // it's already in flight, not skipped.
    captureError(err, obs, { stage: "persist_assistant_message", conversationId: convId });
    await usageEventDone;
    return;
  }
  await settleWrites(convId, inserted[0].id, done, totals, usageEventDone, obs);
}

// Cheap LLM titling on turns 1/4/10 only (≤3 calls per conversation total;
// see title.ts). Unawaited + .catch()'d so it can never surface as an
// unhandled rejection or delay the stream's own teardown — the answer has
// already been sent to the client. Deliberately NOT passed req.signal: the
// SSE response (and thus the signal) is already closing/closed here, so
// forwarding it would make titling a silent no-op on every turn (see title.ts).
const TITLE_AT_TURNS = new Set([1, 4, 10]);
export function titleIfDue(t: ChatTurn, answer: string): void {
  if (!TITLE_AT_TURNS.has(t.priorAssistants + 1)) return;
  void titleConversation(t.convId, buildTitleTranscript(t.history, answer), t.obs).catch((err) =>
    captureError(err, t.obs, { stage: "title" }),
  );
}
