// POST /api/chat — the agentic chat endpoint. Auth-gated, SSE-streamed. Owns
// auth + conversation persistence; the tool-calling control flow lives in the
// pure runChat() loop (chat-loop.ts), the LLM stream in llm.ts.
//
// Order (per advisor): create conversation (if new) + persist the USER message
// BEFORE streaming; persist the ASSISTANT message AFTER the stream completes —
// never partial content.
import type OpenAI from "openai";
import { sql } from "./db.ts";
import { getIndexes } from "./indexes.ts";
import { getSessionUser } from "./session.ts";
import { getModel, openrouterStream } from "./llm.ts";
import { runChat, type ChatEvent } from "./chat-loop.ts";
import { buildSystemPrompt, type PageContext } from "./system-prompt.ts";
import { getWindowUsage } from "./rate-limit.ts";

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

interface ChatBody {
  message: string;
  conversationId?: string;
  pageContext?: PageContext;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
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

  const userId = session.user.id;

  // Hard rate-limit gate on the user's token window — check BEFORE creating a
  // conversation or spending any LLM tokens. The 429 tells the user exactly how
  // many tokens they've used and when the window resets (+ Retry-After header).
  const usage = await getWindowUsage(userId);
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

  const convId = await resolveConversation(userId, body);
  if (!convId) return json({ error: "conversation_not_found" }, 404);

  // Persist the user message before streaming, then load history (includes it).
  await sql`INSERT INTO messages (conversation_id, role, content) VALUES (${convId}, 'user', ${body.message})`;
  const history = (await sql`
    SELECT role, content FROM messages WHERE conversation_id = ${convId} ORDER BY created_at
  `) as { role: string; content: string }[];

  const ix = getIndexes();
  const messages: Msg[] = [
    { role: "system", content: buildSystemPrompt(ix, body.pageContext) },
    ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
  ];

  const startedAt = Date.now();
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: ChatEvent | { type: string; [k: string]: unknown }) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      send({ type: "meta", conversationId: convId });
      try {
        let done: Extract<ChatEvent, { type: "done" }> | null = null;
        for await (const ev of runChat({ ix, messages, stream: openrouterStream, signal: req.signal })) {
          send(ev);
          if (ev.type === "done") done = ev;
        }
        // Don't persist an empty assistant row for an aborted turn.
        if (done && !req.signal.aborted) await persistAssistant(convId, done, Date.now() - startedAt);
      } catch (err) {
        if (!req.signal.aborted) send({ type: "error", message: (err as Error).message });
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

async function persistAssistant(convId: string, done: Extract<ChatEvent, { type: "done" }>, latencyMs: number): Promise<void> {
  // Raw array + ::jsonb (see resolveConversation note) — not JSON.stringify'd.
  const toolCalls = done.toolCalls.length ? done.toolCalls : null;
  await sql`
    INSERT INTO messages (conversation_id, role, content, tool_calls, input_tokens, output_tokens, generation_id, latency_ms)
    VALUES (${convId}, 'assistant', ${done.content}, ${toolCalls}::jsonb,
            ${done.usage.input}, ${done.usage.output}, ${done.generationId}, ${latencyMs})
  `;
  await sql`
    UPDATE conversations
    SET total_input_tokens = total_input_tokens + ${done.usage.input},
        total_output_tokens = total_output_tokens + ${done.usage.output},
        query_atlas_calls = query_atlas_calls + ${done.toolCalls.length},
        updated_at = now()
    WHERE id = ${convId}
  `;
}
