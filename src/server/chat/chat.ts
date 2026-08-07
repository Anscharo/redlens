// POST /api/chat — the agentic chat endpoint. Auth-gated, SSE-streamed. Owns
// auth + conversation persistence; the tool-calling control flow lives in the
// pure runChat() loop (chat-loop.ts), the LLM stream in llm.ts.
//
// Order (per advisor): create conversation (if new) + persist the USER message
// BEFORE streaming; persist the ASSISTANT message AFTER the stream completes —
// never partial content.
import type OpenAI from "openai";
import { sql } from "../db.ts";
import { getIndexes } from "../retrieval/indexes.ts";
import { getSessionUser } from "../session.ts";
import { getModel, makeOpenrouterStream, makeOpenrouterJson } from "./llm.ts";
import { routeTier, resolveTierModels, citationStyleFor } from "./model-router.ts";
import { runVerifiedChat, sanitizeDone, type HarnessDone, type CheckRowMeta } from "./chat-orchestrator.ts";
import { buildSystemPrompt, type PageContext } from "./system-prompt.ts";
import { buildPrefetch, prefetchRound } from "../prefetch.ts";
import { windowHistory } from "./chat-history.ts";
import { titleConversation, buildTitleTranscript } from "./title.ts";
import { config } from "../config.ts";
import { getWindowUsage } from "../rate-limit.ts";
import { json } from "../http.ts";
import { fetchCommons } from "./credits.ts";
import { captureError, type ErrorContext } from "../posthog-node.ts";

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

interface ChatBody {
  message: string;
  conversationId?: string;
  pageContext?: PageContext;
}

// Generous cap on raw user input: well above any real prompt (typical chat
// UIs cap in the low thousands of characters) but far below what would blow
// past the model's context window or get shipped/persisted as multi-MB rows.
export const MAX_MESSAGE_BYTES = 28_000;

// Pure so it's unit-testable without a session/DB fixture.
export function messageExceedsLimit(message: string, limitBytes = MAX_MESSAGE_BYTES): boolean {
  return Buffer.byteLength(message, "utf8") > limitBytes;
}


// Resolve the target conversation: verify ownership of an existing one, or open
// a new row. Returns null if the id was supplied but isn't the caller's.
async function resolveConversation(userId: string, body: ChatBody): Promise<string | null> {
  if (body.conversationId) {
    const owned = (await sql`
      SELECT id FROM conversations WHERE id = ${body.conversationId} AND user_id = ${userId}
    `) as { id: string }[];
    return owned[0]?.id ?? null;
  }
  // Pass the RAW object (not JSON.stringify'd) + ::jsonb cast — Bun JSON-encodes
  // the value once for the cast; pre-stringifying double-encodes it into a jsonb
  // string scalar. Matches the jsonb pattern in sync.ts.
  const pc = body.pageContext ?? null;
  const created = (await sql`
    INSERT INTO conversations (user_id, model, page_context, title)
    VALUES (${userId}, ${getModel()}, ${pc}::jsonb, ${body.message.slice(0, 60)})
    RETURNING id
  `) as { id: string }[];
  return created[0].id;
}

export async function handleChat(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const session = await getSessionUser(req);
  if (!session) return json({ error: "unauthenticated" }, 401);

  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (!body.message?.trim()) return json({ error: "empty_message" }, 400);
  // Reject before any DB write or rate-limit accounting — an oversized first
  // request must not slip past the (past-usage-only) rate limiter below.
  if (messageExceedsLimit(body.message)) {
    return json({ error: "message_too_large", limitBytes: MAX_MESSAGE_BYTES }, 400);
  }

  const userId = session.user.id;

  // Hard rate-limit gate on the user's token window — check BEFORE creating a
  // conversation or spending any LLM tokens. The 429 tells the user exactly how
  // many tokens they've used and when the window resets (+ Retry-After header).
  // Fetched alongside the commons pool below (independent calls — same pairing
  // as handleUsage in rate-limit.ts) so a cold commons cache doesn't stack its
  // OpenRouter latency on top of the DB round trip.
  const [usage, commons] = await Promise.all([getWindowUsage(userId), fetchCommons()]);
  if (usage.exceeded) {
    const retryAfter = Math.max(0, Math.ceil((Date.parse(usage.resetsAt) - Date.now()) / 1000));
    return new Response(
      JSON.stringify({
        error: "rate_limited",
        message: `Usage limit reached — ${usage.tokens.toLocaleString()} of ${usage.limit.toLocaleString()} tokens used this window. Resets at ${usage.resetsAt}.`,
        tokensUsed: usage.tokens,
        limit: usage.limit,
        resetsAt: usage.resetsAt,
        window: usage,
      }),
      { status: 429, headers: { "content-type": "application/json", "retry-after": String(retryAfter) } },
    );
  }

  // Shared "commons" gate: the account-wide OpenRouter credit balance is one
  // pool for ALL users. When it's dry, chat is paused for everyone until it's
  // topped up. null = unknown (key unset or credits API hiccup) → fail OPEN, so
  // a metering blip never blocks chat; only a real remaining <= 0 pauses it.
  if (commons && commons.remaining <= 0) {
    return json(
      {
        error: "commons_exhausted",
        message: "The shared usage pool is out of credits. Chat is paused for everyone until it's topped up.",
        global: commons,
      },
      429,
    );
  }

  const convId = await resolveConversation(userId, body);
  if (!convId) return json({ error: "conversation_not_found" }, 404);

  // Persist the user message before streaming, then load history (includes it).
  // The updated_at bump runs alongside the history SELECT — independent
  // writes, no added latency — so a conversation whose stream later aborts or
  // 429s still sorts by its real last-activity time. Today only
  // persistAssistant bumps updated_at, so an aborted-turn conversation sorts
  // stale until (if ever) it gets a reply. With rename (conversations.ts)
  // deliberately NOT touching updated_at, the invariant `updated_at ≡ last
  // message time` holds exactly, served by the existing conversations_user index.
  await sql`INSERT INTO messages (conversation_id, role, content) VALUES (${convId}, 'user', ${body.message})`;
  const [history] = (await Promise.all([
    sql`SELECT role, content FROM messages WHERE conversation_id = ${convId} ORDER BY created_at`,
    sql`UPDATE conversations SET updated_at = now() WHERE id = ${convId}`,
  ])) as [{ role: string; content: string }[], unknown];

  const ix = getIndexes();

  // Per-turn tier routing (rules-based, free): pick the model chain before any
  // LLM work. Follow-up turns (an assistant reply already in history) never
  // route fast on brevity alone — see model-router.ts. This runs BEFORE the
  // system prompt is built because the citation format the prompt asks for
  // depends on which model will read it.
  const priorAssistants = history.filter((m) => m.role === "assistant").length;
  const route = routeTier(body.message, { followUp: priorAssistants > 0 });
  const models = resolveTierModels(route.tier);

  // The DB keeps the full conversation; the model gets a windowed replay
  // (recent turns verbatim, older ones truncated, hard char budget) so long
  // conversations never grow the per-round context without bound.
  const messages: Msg[] = [
    { role: "system", content: buildSystemPrompt(ix, body.pageContext, citationStyleFor(models[0])) },
    ...windowHistory(history).map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
  ];

  // Deterministic pre-lookup (glossary + entity match, pure code, ~ms): seed a
  // synthetic tool round after the user message so definition/entity questions
  // can answer in ONE request instead of tool-round → answer-round. Injects
  // nothing on a miss; the harness treats it as ordinary turn evidence.
  const prefetch = config.chatPrefetch ? buildPrefetch(ix, body.message) : null;
  if (prefetch) messages.push(...prefetchRound(body.message, prefetch));

  const startedAt = Date.now();
  const encoder = new TextEncoder();
  // PostHog AI observability: one trace per turn (fresh id, conversation id as
  // a filterable property). distinctId is the CONVERSATION, not the signed-in
  // user — semi-anonymous analytics: turns of one conversation stay grouped
  // together in PostHog, but no user identity is sent (userId stays DB-only,
  // via conversations.user_id, never leaves the server). The SAME obs feeds the
  // answer stream, the harness jsonCall (verifier/advisor), and error capture,
  // so every generation AND every error of the turn lands in one trace. No-op
  // when POSTHOG_KEY is unset (both factories fall back to the plain client).
  const obs = {
    distinctId: convId,
    traceId: crypto.randomUUID(),
    properties: { chat_tier: route.tier, chat_route_reason: route.reason },
  };
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: { type: string } & Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      send({ type: "meta", conversationId: convId, tier: route.tier });
      try {
        let done: HarnessDone | null = null;
        const chatStream = makeOpenrouterStream(obs, models);
        // runVerifiedChat = runChat wrapped in the reliability harness (status
        // events, deterministic checks, verifier audit, advisor escalation —
        // model slots are env-gated, unset = pass-through). done carries the
        // internal transcript/checksMeta; sanitizeDone strips them off the wire.
        for await (const ev of runVerifiedChat({
          ix, messages, stream: chatStream, jsonCall: makeOpenrouterJson(obs),
          question: body.message, signal: req.signal, obs,
        })) {
          if (ev.type === "done") {
            done = ev as HarnessDone;
            send(sanitizeDone(done));
          } else {
            send(ev);
          }
        }
        // Don't persist an empty assistant row for an aborted turn.
        if (done && !req.signal.aborted) {
          await persistAssistant(userId, convId, done, Date.now() - startedAt, obs);
          // Cheap LLM titling on turns 1/4/10 only (≤3 calls per conversation
          // total; see title.ts). Unawaited + .catch()'d so it can never
          // surface as an unhandled rejection or delay the stream's own
          // teardown — the answer has already been sent to the client.
          // Deliberately NOT passed req.signal: the SSE response (and thus
          // the signal) is already closing/closed here, so forwarding it
          // would make titling a silent no-op on every turn (see title.ts).
          const TITLE_AT_TURNS = new Set([1, 4, 10]);
          if (TITLE_AT_TURNS.has(priorAssistants + 1)) {
            void titleConversation(convId, buildTitleTranscript(history, done.content), obs).catch((err) =>
              captureError(err, obs, { stage: "title" }),
            );
          }
        }
      } catch (err) {
        if (!req.signal.aborted) {
          captureError(err, obs, { stage: "stream_handler" });
          send({ type: "error", message: (err as Error).message });
        }
      } finally {
        controller.close();
      }
    },
  });

  const headers = new Headers({
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
  if (session.refresh) headers.append("set-cookie", session.refresh);
  return new Response(stream, { headers });
}

// Exported for direct unit testing (chat.test.ts) — constructing a full
// HarnessDone via the real HTTP+streaming+harness path just to exercise the
// usage_events summation would require standing up the verifier/advisor
// network flow the "titling" describe block below already shows is a heavy
// lift; this function's persistence logic is worth testing directly instead.
export async function persistAssistant(
  userId: string, convId: string, done: HarnessDone, latencyMs: number, obs?: ErrorContext,
): Promise<void> {
  // Raw array + ::jsonb (see resolveConversation note) — not JSON.stringify'd.
  const toolCalls = done.toolCalls.length ? done.toolCalls : null;

  // Harness (verifier/advisor) tokens count toward the conversation totals and
  // the rate-limit window (via the usage_events row below) — never toward the
  // messages row, which stays conversationalist-only so the sums don't
  // double-count.
  const checkIn = (done.checksMeta ?? []).reduce((s, c) => s + (c.inputTokens ?? 0), 0);
  const checkOut = (done.checksMeta ?? []).reduce((s, c) => s + (c.outputTokens ?? 0), 0);
  const usageInput = done.usage.input + checkIn;
  const usageOutput = done.usage.output + checkOut;

  const insertUsageEvent = (conversationId: string | null) => sql`
    INSERT INTO usage_events (user_id, conversation_id, input_tokens, output_tokens)
    VALUES (${userId}, ${conversationId}, ${usageInput}, ${usageOutput})
  `;

  // Fired concurrently with the messages insert below, not awaited yet — the
  // two are mutually independent (usage_events doesn't need the message
  // row's id, and quota accounting must be attempted regardless of whether
  // the message insert itself succeeds), so serializing them would add a
  // full extra DB round trip to every turn's tail latency for no benefit.
  //
  // The `meta` SSE event ships convId back to the client before any model
  // work starts (see the `send` call above), so a client can DELETE
  // /api/chat/conversations/:id while this turn is still streaming — by the
  // time this function runs, the conversation row may already be gone.
  // messages.conversation_id is NOT NULL + ON DELETE CASCADE, so inserting
  // against a deleted conversation FK-fails; if usage_events were only
  // written after that insert succeeded, a well-timed delete would skip
  // quota accounting entirely — the same reclaim-by-delete hole migration 017
  // closed, just relocated into this race window instead of the cascade.
  // usage_events.conversation_id is nullable (ON DELETE SET NULL, provenance
  // only — see migration 017) precisely so this can degrade to an
  // orphaned-but-counted row instead of failing outright.
  const usageEventDone = insertUsageEvent(convId).catch((err) => {
    captureError(err, obs, { stage: "usage_events_insert", conversationId: convId });
    return insertUsageEvent(null);
  });

  let inserted: { id: string }[];
  try {
    inserted = (await sql`
      INSERT INTO messages (conversation_id, role, content, tool_calls, input_tokens, output_tokens, generation_id, latency_ms)
      VALUES (${convId}, 'assistant', ${done.content}, ${toolCalls}::jsonb,
              ${done.usage.input}, ${done.usage.output}, ${done.generationId}, ${latencyMs})
      RETURNING id
    `) as { id: string }[];
  } catch (err) {
    // Conversation deleted mid-turn: there's nowhere left to save the answer
    // or bump conversation totals. Still wait for quota accounting to land —
    // it's already in flight above, not skipped.
    captureError(err, obs, { stage: "persist_assistant_message", conversationId: convId });
    await usageEventDone;
    return;
  }

  // The checks rows and the conversations totals update are independent
  // writes (neither depends on the other's result, nor on the still-in-flight
  // usage_events write above) — run all three concurrently instead of
  // stacking round trips on the client's already-completed answer.
  // persistChecks degrades to a logged no-op on failure (e.g. a boot-time
  // race against the message_checks migration): the assistant message above
  // is already durably persisted, so a telemetry-row failure must never
  // surface as a turn-level error to a client that already has the complete
  // answer.
  await Promise.all([
    usageEventDone,
    persistChecks(inserted[0].id, done.checksMeta ?? []).catch((err) => {
      captureError(err, obs, { stage: "persist_checks" });
    }),
    sql`
      UPDATE conversations
      SET total_input_tokens = total_input_tokens + ${usageInput},
          total_output_tokens = total_output_tokens + ${usageOutput},
          query_atlas_calls = query_atlas_calls + ${done.toolCalls.length},
          updated_at = now()
      WHERE id = ${convId}
    `,
  ]);
}

async function persistChecks(messageId: string, rows: CheckRowMeta[]): Promise<void> {
  await Promise.all(
    rows.map(
      (r) => sql`
        INSERT INTO message_checks (message_id, kind, model, action, verdict, overall, input_tokens, output_tokens, generation_id, latency_ms)
        VALUES (${messageId}, ${r.kind}, ${r.model}, ${r.action}, ${r.verdict ?? null}::jsonb, ${r.overall},
                ${r.inputTokens}, ${r.outputTokens}, ${r.generationId}, ${r.latencyMs})
      `,
    ),
  );
}
