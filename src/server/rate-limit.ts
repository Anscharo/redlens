// Per-user token rate limit — the hard gate on /api/chat. Fixed-clock window:
// the timeline is cut into fixed `rateLimitWindowMinutes` buckets aligned to the
// epoch (so 120-min buckets land on 00:00, 02:00, 04:00 … UTC). A user may spend
// up to `rateLimitTokensPerWindow` input+output tokens per bucket; at the limit,
// /api/chat returns 429 until the next bucket. Simpler than a rolling window —
// reset is just "the next boundary", one SUM, no prefix math.
//
// We gate on PAST usage (known exactly from persisted input_tokens+output_tokens),
// so one final over-the-line request can still land — acceptable; the next is
// refused. The token count, not request count, is the unit so a heavy multi-tool
// query costs proportionally more of the budget than a cheap one.
//
// Quota source of truth: `usage_events` (migration 017), an append-only ledger
// written once per turn by chat.ts's persistAssistant, alongside — not instead
// of — the existing messages.input_tokens/output_tokens and
// message_checks.input_tokens/output_tokens columns. This function used to SUM
// those two tables directly, joined back to the user through
// conversations.user_id; that made the window reclaimable, because DELETE
// /api/chat/conversations/:id cascades messages (and via messages,
// message_checks) — a rate-limited user could delete history to reset their
// usage and keep chatting. usage_events has no such cascade from a
// conversation/message delete (see migration 017's FK comments), so it moves
// the SOURCE OF TRUTH FOR QUOTA off the cascadable tables — it does not
// duplicate it: `messages`/`message_checks` token columns remain per-row
// provenance/telemetry (cost backfill, per-message display, dashboards).
// getWindowUsage was verified to be their only reader for quota purposes, so
// nothing else needs to change to keep the two in sync.
import { sql } from "./db.ts";
import { config } from "./config.ts";
import { json } from "./http.ts";
import { getSessionUser } from "./session.ts";
import { fetchCommons } from "./chat/credits.ts";

export interface WindowUsage {
  tokens: number; // input+output tokens spent in the current bucket
  limit: number;
  exceeded: boolean;
  resetsAt: string; // ISO — next bucket boundary
  windowMinutes: number;
}

// Pure: the [start, reset) bounds of the bucket containing nowMs. Aligned to the
// epoch, which for buckets that divide 24h means aligned to the wall clock.
export function bucketBounds(nowMs: number, windowMs: number): { startMs: number; resetsAtMs: number } {
  const startMs = nowMs - (nowMs % windowMs);
  return { startMs, resetsAtMs: startMs + windowMs };
}

export async function getWindowUsage(userId: string, nowMs: number = Date.now()): Promise<WindowUsage> {
  const windowMinutes = config.rateLimitWindowMinutes;
  const limit = config.rateLimitTokensPerWindow;
  const { startMs, resetsAtMs } = bucketBounds(nowMs, windowMinutes * 60_000);
  // One sum against the ledger — already includes both conversationalist
  // tokens and reliability-harness (verifier/advisor) tokens, since
  // persistAssistant writes one usage_events row per turn covering both (see
  // chat.ts). The harness spends real tokens per turn — it must count against
  // the same budget, or checks become an invisible way past the window.
  const rows = (await sql`
    SELECT COALESCE(SUM(input_tokens + output_tokens), 0)::int AS tokens
    FROM usage_events
    WHERE user_id = ${userId} AND created_at >= ${new Date(startMs)}
  `) as { tokens: number }[];
  const tokens = Number(rows[0]?.tokens ?? 0);
  return { tokens, limit, exceeded: tokens >= limit, resetsAt: new Date(resetsAtMs).toISOString(), windowMinutes };
}

// GET /api/usage — the chat widget's usage meter. Two blocks: `window` (the
// caller's private per-user token window) and `global` (the shared "commons"
// dollar pool, same number for everyone). Both are signed-in-only (this route
// already 401s without a session). `global` is omitted when the commons feature
// is off or the credits API is unreachable — the meter just hides its row.
export async function handleUsage(req: Request): Promise<Response> {
  const session = await getSessionUser(req);
  if (!session) return json({ error: "unauthenticated" }, 401);
  const [window, global] = await Promise.all([getWindowUsage(session.user.id), fetchCommons()]);
  return json({ window, ...(global ? { global } : {}) }, 200, session.refresh);
}
