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

// chat.ts names all three 429 causes; resetsAt presence is only the fallback.
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

// Not setError: RateLimitNote explains a 429, and leaving `error` unset stops the
// text resurfacing as an ErrorNote banner when the lock lifts.
function rateLimited(core: StreamCore, body: RefusalBody): SendResult {
  const rateLimit = rateLimitFromBody(body);
  core.finalizeLast({ content: rateLimit.message });
  core.setStreaming(false);
  return { rateLimited: rateLimit };
}

// Deleted elsewhere since hydrate: drop the stale id so the next send starts
// fresh, and fail the turn quietly rather than through ErrorNote.
function conversationGone(core: StreamCore): SendResult {
  core.setConversation(null);
  core.setContextTokens(null);
  core.finalizeLast({ failed: true });
  core.setStreaming(false);
  return {};
}

// The result of an outright refusal, or null to read the response as a stream.
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
