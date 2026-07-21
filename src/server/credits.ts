// The shared "commons" pool: the account-wide OpenRouter credit balance, shown
// to every signed-in user as ONE number — how many real dollars the shared
// account has left. Unlike the per-user token window (rate-limit.ts), this is
// not sliced per user: everyone sees the same pool, and when it's dry, chat is
// paused for all (chat.ts hard-gate).
//
// Sourced from OpenRouter's own accounting (GET /api/v1/credits → dollars,
// lifetime-cumulative prepaid wallet), so it needs no per-message cost
// reconciler — total_usage already counts every dollar the account spends.
// Requires a MANAGEMENT/provisioning key, distinct from the model-call key
// (openrouterApiKey); the credits endpoint rejects the model key.
import { config } from "./config.ts";

export interface CommonsPool {
  used: number; // dollars spent account-wide (lifetime)
  total: number; // dollars purchased (pool size)
  remaining: number; // total - used, floored at 0
}

const CREDITS_URL = "https://openrouter.ai/api/v1/credits";
// The credits endpoint is account-global and moves slowly; cache so widget
// traffic (every panel open + every turn's post-answer refresh, × all users)
// can't hammer OpenRouter. Short enough that "remaining" still tracks real spend.
const TTL_MS = 30_000;

let cache: { at: number; pool: CommonsPool | null } | null = null;
let warnedNoKey = false; // one-time reminder so the log isn't spammed per request

interface CreditsResponse {
  data?: { total_credits?: number; total_usage?: number };
}

// Returns null (never a zero pool) when the feature is off (no management key)
// or on any fetch/parse failure — callers MUST treat null as "unknown" and fail
// OPEN (never hard-gate chat on a metering blip); only a real remaining <= 0
// pauses chat. `key`/`fetchImpl`/`now` are injectable for tests.
export async function fetchCommons(
  opts: { key?: string; fetchImpl?: typeof fetch; now?: number } = {},
): Promise<CommonsPool | null> {
  const key = opts.key ?? config.openrouterManagementKey;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now();
  // No management key → the shared-pool meter is simply off. Never fail hard:
  // return null so the widget hides and chat's commons gate never fires. Emit a
  // single light reminder (not per request) so operators know it's disabled.
  if (!key) {
    if (!warnedNoKey) {
      warnedNoKey = true;
      console.info("[commons] OPENROUTER_MANAGEMENT_KEY not set — shared credit-pool meter disabled; chat is unaffected.");
    }
    return null;
  }
  if (cache && now - cache.at < TTL_MS) return cache.pool;

  let pool: CommonsPool | null = null;
  try {
    const res = await fetchImpl(CREDITS_URL, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const body = (await res.json()) as CreditsResponse;
      const total = Number(body.data?.total_credits);
      const used = Number(body.data?.total_usage);
      if (Number.isFinite(total) && Number.isFinite(used)) {
        pool = { used, total, remaining: Math.max(0, total - used) };
      }
    }
  } catch {
    pool = null; // network/timeout/JSON — unknown, not empty
  }
  cache = { at: now, pool };
  return pool;
}

// Test-only: drop the TTL cache so each case fetches fresh.
export function __resetCommonsCache(): void {
  cache = null;
}
