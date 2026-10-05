// POST /api/chat's refusals: a malformed request, and the three caps a turn
// must clear before it creates anything — per-user concurrency, the user's
// token window, and the shared credit pool.
import { getSessionUser } from "../../session.ts";
import { json } from "../../http.ts";
import { config } from "../../config.ts";
import { getWindowUsage } from "../../rate-limit.ts";
import { fetchCommons } from "../credits.ts";
import type { PageContext } from "../system-prompt.ts";

export interface ChatBody {
  message: string;
  conversationId?: string;
  pageContext?: PageContext;
}

type Session = NonNullable<Awaited<ReturnType<typeof getSessionUser>>>;

// Generous cap on raw user input: well above any real prompt (typical chat
// UIs cap in the low thousands of characters) but far below what would blow
// past the model's context window or get shipped/persisted as multi-MB rows.
export const MAX_MESSAGE_BYTES = 28_000;

// Pure so it's unit-testable without a session/DB fixture.
export function messageExceedsLimit(message: string, limitBytes = MAX_MESSAGE_BYTES): boolean {
  return Buffer.byteLength(message, "utf8") > limitBytes;
}

/** The authenticated, well-formed request — or the response refusing it. */
export async function parseChatRequest(req: Request): Promise<{ session: Session; body: ChatBody } | Response> {
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
  // request must not slip past the (past-usage-only) rate limiter.
  if (messageExceedsLimit(body.message)) {
    return json({ error: "message_too_large", limitBytes: MAX_MESSAGE_BYTES }, 400);
  }
  return { session, body };
}

export function concurrencyRefusal(): Response {
  return json(
    {
      error: "too_many_concurrent",
      message: `You already have ${config.chatMaxConcurrentPerUser} chat requests in progress — wait for one to finish before starting another.`,
      limit: config.chatMaxConcurrentPerUser,
    },
    429,
  );
}

// The 429 tells the user exactly how many tokens they've used and when the
// window resets (+ Retry-After header).
function rateLimited(usage: Awaited<ReturnType<typeof getWindowUsage>>): Response {
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

// Hard rate-limit gate on the user's token window — checked BEFORE creating a
// conversation or spending any LLM tokens. Fetched alongside the commons pool
// (independent calls — same pairing as handleUsage in rate-limit.ts) so a cold
// commons cache doesn't stack its OpenRouter latency on top of the DB round
// trip.
//
// Shared "commons" gate: the account-wide OpenRouter credit balance is one
// pool for ALL users. When it's dry, chat is paused for everyone until it's
// topped up. null = unknown (key unset or credits API hiccup) → fail OPEN, so
// a metering blip never blocks chat; only a real remaining <= 0 pauses it.
export async function quotaRefusal(userId: string): Promise<Response | null> {
  const [usage, commons] = await Promise.all([getWindowUsage(userId), fetchCommons()]);
  if (usage.exceeded) return rateLimited(usage);
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
  return null;
}
