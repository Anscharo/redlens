// Per-user token rate limit — the hard gate on /api/chat. Fixed-clock window:
// the timeline is cut into fixed `rateLimitWindowMinutes` buckets aligned to the
// epoch (so 120-min buckets land on 00:00, 02:00, 04:00 … UTC). A user may spend
// up to `rateLimitTokensPerWindow` input+output tokens per bucket; at the limit,
// /api/chat returns 429 until the next bucket. Simpler than a rolling window —
// reset is just "the next boundary", one SUM, no prefix math.
//
// Boost tier: a GitHub login listed in `config.rateLimitBoostLogins`
// (RATE_LIMIT_BOOST_LOGINS, a lowercased CSV) gets `rateLimitTokensPerWindowBoosted`
// (RATE_LIMIT_TOKENS_PER_WINDOW_BOOSTED) instead of the base limit — see
// limitForLogin, the pure decision the DB-backed lookup below feeds. The login
// is NOT carried on the session JWT (a 7-day cookie; auth.ts re-upserts
// `users.github_login` on every OAuth precisely because logins drift), so it is
// read fresh from Postgres alongside the usage SUM instead, and only a row with
// `provider = 'github'` may match — a Google account whose display name happens
// to equal a GitHub login must never inherit that login's budget. The allowlist
// query runs CONCURRENTLY with the usage SUM (Promise.all): this gate sits on
// every /api/chat POST, so a serial round trip is not acceptable. When the
// allowlist is empty (the default) the query is skipped entirely — the feature
// then costs nothing beyond the one existing SUM. A failed or empty login
// lookup always degrades to the base limit, never to boosted.
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
  boosted: boolean; // true when `limit` is the boosted, not base, tier
}

// Pure: which limit applies to this caller. `githubLogin` is whatever the DB
// lookup in getWindowUsage resolved (null when unresolved, non-github, or the
// allowlist is empty) — trimmed/lowercased here too, so a caller can pass a
// raw value without pre-normalizing. Guarded against a misconfigured boosted
// value: if RATE_LIMIT_TOKENS_PER_WINDOW_BOOSTED is unset-to-NaN or a typo left
// it BELOW the base limit, an allowlisted user must never end up with a
// SMALLER budget than everyone else — fall back to base instead.
export function limitForLogin(githubLogin: string | null): number {
  const base = config.rateLimitTokensPerWindow;
  if (!githubLogin) return base;
  const login = githubLogin.trim().toLowerCase();
  if (!config.rateLimitBoostLogins.includes(login)) return base;
  const boosted = config.rateLimitTokensPerWindowBoosted;
  if (!Number.isFinite(boosted) || boosted < base) return base;
  return boosted;
}

// Pure: the [start, reset) bounds of the bucket containing nowMs. Aligned to the
// epoch, which for buckets that divide 24h means aligned to the wall clock.
export function bucketBounds(nowMs: number, windowMs: number): { startMs: number; resetsAtMs: number } {
  const startMs = nowMs - (nowMs % windowMs);
  return { startMs, resetsAtMs: startMs + windowMs };
}

export async function getWindowUsage(userId: string, nowMs: number = Date.now()): Promise<WindowUsage> {
  const windowMinutes = config.rateLimitWindowMinutes;
  const { startMs, resetsAtMs } = bucketBounds(nowMs, windowMinutes * 60_000);

  // Skip the allowlist lookup entirely when nobody is boosted (the default) —
  // this gate runs on every /api/chat POST and must cost zero extra DB work
  // for the common case. Only `provider = 'github'` may match; a Google
  // account can never inherit a GitHub login's budget. Once the allowlist is
  // non-empty this query runs for EVERY user (not just allowlisted ones, since
  // we don't know who's allowlisted until we look), so a rejected query here
  // must not fail the whole gate the way a rejected usage SUM legitimately
  // would (that one is load-bearing — without it we can't compute usage at
  // all). Caught and degraded to "unresolved" instead, same as an empty row.
  const loginQuery: Promise<{ github_login: string | null }[]> =
    config.rateLimitBoostLogins.length === 0
      ? Promise.resolve([])
      : (sql`
          SELECT github_login FROM users WHERE id = ${userId} AND provider = 'github'
        ` as Promise<{ github_login: string | null }[]>).catch((err: unknown) => {
          console.warn("[rate-limit] boost login lookup failed — degrading to base limit:", err);
          return [];
        });

  // One sum against the ledger — already includes both conversationalist
  // tokens and reliability-harness (verifier/advisor) tokens, since
  // persistAssistant writes one usage_events row per turn covering both (see
  // chat.ts). The harness spends real tokens per turn — it must count against
  // the same budget, or checks become an invisible way past the window.
  const [usageRows, loginRows] = await Promise.all([
    sql`
      SELECT COALESCE(SUM(input_tokens + output_tokens), 0)::int AS tokens
      FROM usage_events
      WHERE user_id = ${userId} AND created_at >= ${new Date(startMs)}
    ` as Promise<{ tokens: number }[]>,
    loginQuery,
  ]);

  const tokens = Number(usageRows[0]?.tokens ?? 0);
  // Empty/unresolved lookup (no row, non-github provider, or the allowlist
  // being empty) resolves to null here, and limitForLogin degrades that to
  // the base limit — never boosted.
  const login = loginRows[0]?.github_login ?? null;
  const limit = limitForLogin(login);
  const boosted = limit > config.rateLimitTokensPerWindow;
  return {
    tokens,
    limit,
    exceeded: tokens >= limit,
    resetsAt: new Date(resetsAtMs).toISOString(),
    windowMinutes,
    boosted,
  };
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
  return json(
    { window, contextWindowTokens: config.chatContextWindowTokens, ...(global ? { global } : {}) },
    200,
    session.refresh,
  );
}
