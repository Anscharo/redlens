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
import { sql } from "./db.ts";
import { config } from "./config.ts";
import { getSessionUser } from "./session.ts";

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
  const rows = (await sql`
    SELECT COALESCE(SUM(COALESCE(m.input_tokens, 0) + COALESCE(m.output_tokens, 0)), 0)::int AS tokens
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE c.user_id = ${userId} AND m.created_at >= ${new Date(startMs)}
  `) as { tokens: number }[];
  const tokens = Number(rows[0]?.tokens ?? 0);
  return { tokens, limit, exceeded: tokens >= limit, resetsAt: new Date(resetsAtMs).toISOString(), windowMinutes };
}

// GET /api/usage — the per-user window for the chat widget's usage meter. Global
// pool (OpenRouter credits) is a separate concern, added later.
export async function handleUsage(req: Request): Promise<Response> {
  const session = await getSessionUser(req);
  if (!session) return new Response(JSON.stringify({ error: "unauthenticated" }), { status: 401, headers: { "content-type": "application/json" } });
  const window = await getWindowUsage(session.user.id);
  const headers = new Headers({ "content-type": "application/json" });
  if (session.refresh) headers.append("set-cookie", session.refresh);
  return new Response(JSON.stringify({ window }), { status: 200, headers });
}
