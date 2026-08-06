// Anti-spam accounting for POST /api/feedback.
//
// Every limit is keyed on the submitter (user id when signed in, else the
// random rl_fb cookie) and counted in Postgres — never on IP and never in
// memory. Railway's load balancer collapses every client into one address
// (see docs/reviews/2026-07-09-deep-code-review.md), and an in-process
// counter would both under-count across replicas and reset on every deploy.
import { sql } from "./db.ts";

export const FB_COOKIE = "rl_fb";
const FB_COOKIE_MAX_AGE = 365 * 24 * 60 * 60; // 1 year

export function feedbackCookie(value: string): string {
  return `${FB_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${FB_COOKIE_MAX_AGE}`;
}

export function rateLimited(retryAfterSeconds: number): Response {
  return new Response(JSON.stringify({ error: "rate_limited", retryAfterSeconds }), {
    status: 429,
    headers: { "content-type": "application/json", "retry-after": String(retryAfterSeconds) },
  });
}

export interface LimitCounts {
  hourly: number;
  daily: number;
  dupe: number;
}

// One round trip for all three checks (hourly count, daily count, 10-minute
// dedupe) rather than three. Keyed on COALESCE(user_id::text, submitter_key):
// a signed-in user's limit follows them across the anonymous cookie they may
// also carry; an anonymous submitter is keyed purely on the cookie.
export async function rateLimitAndDedupe(rateKey: string, hash: string): Promise<LimitCounts> {
  const rows = (await sql`
    SELECT
      count(*) FILTER (WHERE created_at > now() - interval '1 hour')::int AS hourly,
      count(*) FILTER (WHERE created_at > now() - interval '1 day')::int AS daily,
      count(*) FILTER (WHERE message_hash = ${hash} AND created_at > now() - interval '10 minutes')::int AS dupe
    FROM feedback
    WHERE COALESCE(user_id::text, submitter_key) = ${rateKey}
  `) as LimitCounts[];
  return rows[0] ?? { hourly: 0, daily: 0, dupe: 0 };
}

// Global circuit breaker across ALL submitters, cookie-rotating floods
// included — the one layer per-submitter keying can't stop.
export async function globalCountToday(): Promise<number> {
  const rows = (await sql`
    SELECT count(*)::int AS n FROM feedback WHERE created_at > now() - interval '1 day'
  `) as { n: number }[];
  return rows[0]?.n ?? 0;
}
