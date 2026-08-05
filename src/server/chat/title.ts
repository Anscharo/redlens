// Cheap LLM titling for a chat conversation. Fired (unawaited) from chat.ts
// after assistant turns 1, 4, and 10 — never on the request path's critical
// section, never blocking the stream.
import type OpenAI from "openai";
import { sql } from "../db.ts";
import { config } from "../config.ts";
import { callWithTimeout, makeOpenrouterJson, type JsonCall } from "./llm.ts";
import { windowHistory, type HistoryRow } from "./chat-history.ts";
import { captureError, type ErrorContext } from "../posthog-node.ts";

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

const TITLE_SYSTEM = [
  "You title chat conversations for a governance research assistant grounded in the Sky Atlas.",
  "Read the transcript and produce a short, specific title naming the actual topic — not a restated question, not generic ('Chat', 'Question').",
  "3-6 words. No trailing punctuation. No surrounding quotes.",
  'Respond with STRICT JSON only: {"title":"…"}',
].join("\n");

function buildTitlePrompt(transcript: string): Msg[] {
  return [
    { role: "system", content: TITLE_SYSTEM },
    { role: "user", content: transcript },
  ];
}

// Tolerant parse — cheap OpenRouter providers sometimes 400 on
// response_format:"json_object" (degrading to plain prose) or wrap the title
// in quotes instead of proper JSON. Chain: strip code fences → JSON.parse →
// .title; on parse failure fall back to the raw first line; then strip
// wrapping quotes/trailing period, collapse whitespace, cap at 6 words / 60
// chars. Empty after all that → null (caller keeps the existing title).
export function parseTitle(raw: string): string | null {
  const stripped = raw.replace(/```(?:json)?/g, "").trim();
  let candidate: string | null = null;
  try {
    const parsed = JSON.parse(stripped) as { title?: unknown };
    if (parsed && typeof parsed === "object" && typeof parsed.title === "string") candidate = parsed.title;
  } catch {
    // Not JSON (or a bare JSON string with no .title) — salvage the first line.
  }
  if (candidate === null) candidate = stripped.split("\n")[0] ?? "";

  let title = candidate
    .trim()
    .replace(/^["'‘’“”]+|["'‘’“”]+$/g, "")
    .replace(/\.+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!title) return null;

  const words = title.split(" ");
  if (words.length > 6) title = words.slice(0, 6).join(" ");
  if (title.length > 60) title = title.slice(0, 60).trim();
  return title || null;
}

// ~2k char hard cap — reuses windowHistory (chat-history.ts) but with
// EXPLICIT tight options, never its defaults (keepRecent:8/oldMaxChars:600/
// budgetChars:24_000 — the CHAT REPLAY budget). Inheriting those would make
// three ~24k-char prompts per conversation, not the "very cheap call" this
// feature asks for. DO NOT remove these explicit options / let this call
// site drift onto windowHistory's defaults.
//
// `history` is the DB row set loaded in chat.ts BEFORE the assistant reply
// was persisted (so it never includes the just-produced answer) —
// `latestAssistantContent` (done.content) is passed separately and appended.
// The first user message is re-added explicitly: it anchors the topic, and
// budgetChars:2_000 can push it out of a turn-10 window entirely (that's
// exactly what keepRecent:2 drops once enough newer turns exist).
const TITLE_WINDOW = { keepRecent: 2, oldMaxChars: 200, budgetChars: 2_000 };
const FIRST_USER_MAX_CHARS = 200;
const LATEST_ANSWER_MAX_CHARS = 500;
// Defensive final backstop, NOT redundant with TITLE_WINDOW.budgetChars above.
// windowHistory always admits its newest row unconditionally (kept.length===0
// on the first iteration of its loop), and the newest row of `rest` is the
// user's own just-inserted message — which chat.ts allows up to
// MAX_MESSAGE_BYTES (28_000 bytes). A single legal 28KB question on turn 1 of
// a brand-new conversation would otherwise produce a ~28KB titling prompt,
// exactly the cost windowHistory's options were supposed to prevent. Slice
// the fully-assembled transcript too so no single oversized row can defeat
// the cap.
const TITLE_TRANSCRIPT_MAX_CHARS = 2_500;

export function buildTitleTranscript(history: HistoryRow[], latestAssistantContent: string): string {
  const nonEmpty = history.filter((m) => m.content.trim() !== "");
  const firstUser = nonEmpty.find((m) => m.role === "user");
  const rest = firstUser ? nonEmpty.filter((m) => m !== firstUser) : nonEmpty;
  const windowed = windowHistory(rest, TITLE_WINDOW);
  const rows: HistoryRow[] = [
    ...(firstUser ? [{ role: firstUser.role, content: firstUser.content.slice(0, FIRST_USER_MAX_CHARS) }] : []),
    ...windowed,
    { role: "assistant", content: latestAssistantContent.slice(0, LATEST_ANSWER_MAX_CHARS) },
  ];
  const joined = rows.map((m) => `${m.role}: ${m.content}`).join("\n\n");
  return joined.length > TITLE_TRANSCRIPT_MAX_CHARS ? joined.slice(0, TITLE_TRANSCRIPT_MAX_CHARS) : joined;
}

// Fired unawaited from chat.ts, wrapped in its own .catch() there too — this
// function ALSO never throws (every failure path returns silently), so the
// double guard is defense-in-depth, not redundancy elimination.
export async function titleConversation(
  convId: string,
  transcript: string,
  obs?: ErrorContext,
  call: JsonCall = makeOpenrouterJson(obs, "atlas-chat-title"),
): Promise<void> {
  const model = config.chatTitleModel;
  if (!model) return; // empty string disables titling — same convention as chatVerifierModel

  try {
    // No `signal` passed to callWithTimeout: by the time this runs (after
    // persistAssistant, fire-and-forget from chat.ts) the SSE response has
    // already closed, so req.signal is already aborted — forwarding it would
    // make titling a silent permanent no-op. callWithTimeout's own internal
    // AbortController is what actually bounds this call.
    const res = await callWithTimeout(
      call,
      { model, messages: buildTitlePrompt(transcript), maxTokens: 60 },
      config.chatTitleTimeoutMs,
    );
    const title = parseTitle(res.text);
    if (!title) return; // unparseable / empty — keep the existing title

    // Single conditional UPDATE, never read-then-write. A manual rename sets
    // title_source='user', which permanently excludes future auto-titling —
    // this WHERE clause is the entire enforcement of that guarantee.
    await sql`
      UPDATE conversations SET title = ${title}, title_source = 'auto'
      WHERE id = ${convId} AND title_source <> 'user'
    `;
    // Deliberately NO message_checks row: rate-limit.ts's getWindowUsage sums
    // that table into the caller's token window. Titling is a system-
    // initiated call, not part of the user's turn — a row here would
    // silently charge the user's rate-limit budget for it.
  } catch (err) {
    // On ANY failure (transport error, timeout, a provider 400 on
    // response_format) the existing title is left untouched. This path is
    // load-bearing, not defensive — cheap OpenRouter providers don't
    // uniformly accept response_format:"json_object".
    captureError(err, obs, { stage: "title" });
  }
}
