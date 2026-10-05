import type { StreamCore } from "./streamCore";
import type { RateLimitState, SendResult } from "./types";

interface RefusalBody {
  error?: string;
  message?: string;
  resetsAt?: string;
}

/** The handlers a refused request can call out to. */
export interface StreamHandlers {
  onDone?: () => void; // refresh usage, etc.
  onAuthError?: () => void; // 401 → openAuth()
}

async function readJson(res: Response): Promise<RefusalBody> {
  return (await res.json().catch(() => ({}))) as RefusalBody;
}

// chat.ts sends an explicit discriminator for all three 429 causes
// ("rate_limited" carries resetsAt; "commons_exhausted" and
// "too_many_concurrent" never do) — the resetsAt-presence heuristic is only
// the fallback for a body missing the discriminator.
export function rateLimitFromBody(body: RefusalBody): RateLimitState {
  const message = body.message ?? "Usage limit reached.";
  const kind: RateLimitState["kind"] =
    body.error === "too_many_concurrent"
      ? "concurrent"
      : body.error === "commons_exhausted"
        ? "commons"
        : body.resetsAt
          ? "token"
          : "commons";
  return { message, resetsAt: body.resetsAt, kind };
}

// Deliberately not setError(message): `error` means "something broke and we
// don't have a better explanation" (ErrorNote). A 429 already has a full
// explanation — the thread content plus the returned `rateLimited` (which
// drives RateLimitNote) — so leaving `error` untouched keeps the two UI states
// disjoint, and the 429 text cannot resurface as an error banner the instant
// the rate-limit lock lifts.
function rateLimited(core: StreamCore, body: RefusalBody): SendResult {
  const rateLimit = rateLimitFromBody(body);
  core.finalizeLast({ content: rateLimit.message });
  core.setStreaming(false);
  return { rateLimited: rateLimit };
}

// The conversation was deleted elsewhere (another tab, or the /conversations
// page) between hydrate and this send. Clear the stale id so the NEXT send
// starts a fresh conversation server-side, and finalize this turn as failed —
// Message.tsx's own "didn't come through" copy — rather than routing it
// through `error` (ErrorNote's generic banner), which would misrepresent a
// stale reference as a real failure.
function conversationGone(core: StreamCore): SendResult {
  core.setConversation(null);
  core.setContextTokens(null);
  core.finalizeLast({ failed: true });
  core.setStreaming(false);
  return {};
}

// The turn's result when the server refused the request outright, or null
// when the response should be read as a stream. Any other non-ok status is
// left to the caller to throw as a generic failure.
export async function readRefusal(res: Response, core: StreamCore, handlers: StreamHandlers): Promise<SendResult | null> {
  if (res.status === 401) {
    handlers.onAuthError?.();
    core.finalizeLast();
    core.setStreaming(false);
    return {};
  }
  if (res.status === 429) return rateLimited(core, await readJson(res));
  if (res.status === 404 && (await readJson(res)).error === "conversation_not_found") return conversationGone(core);
  return null;
}
