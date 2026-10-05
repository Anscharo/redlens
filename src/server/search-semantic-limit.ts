// The budget gate on GET /api/search/semantic.
//
// That route is PUBLIC — the reader's meaning lane needs no login — and every
// request that gets past the guards spends real money and real database time:
// one OpenRouter embedding call — it carries both the query and leaf
// attribution's residual, so attribution adds no second one — and, for an `in:`
// scope, an exact pass over every searchable vector.
//
// Two budgets. A signed-in reader spends their own hourly allowance
// (`config.searchSemanticUserPerHour`) and never touches the shared one, so a
// crowd of anonymous readers cannot crowd them out and they cannot crowd out the
// crowd. Everyone else shares one per-minute bucket (`config.searchSemanticRpm`).
//
// The shared bucket is GLOBAL, not per-caller, and deliberately so. Per-IP is the usual shape, but
// the thing being protected here is a shared external budget: one caller
// rotating addresses would defeat a per-IP limit while a global one still
// holds the spend flat. The cost is that a burst from one reader can crowd out
// another for a few seconds; a token bucket rather than a fixed window is what
// keeps that to seconds — the refill is continuous, so the budget comes back
// smoothly instead of everyone waiting for the same clock boundary.
//
// It is in-process, so a deployment running N instances allows N times this.
// That is fine for what this defends (an order of magnitude, not a quota) and
// avoids putting a Postgres round-trip in front of a search that is supposed to
// feel instant.
import { config } from "./config.ts";

export interface Bucket {
  /** Tokens available right now, fractional between refills. */
  tokens: number;
  /** When `tokens` was last brought up to date (ms since epoch). */
  last: number;
}

export function newBucket(rpm: number, now: number): Bucket {
  return { tokens: rpm, last: now };
}

/**
 * Take one token if the budget allows, refilling for elapsed time first.
 *
 * Pure apart from mutating the bucket it is handed, so the interesting cases —
 * a burst draining it, the refill rate, the retry-after arithmetic — are
 * testable without a clock or a server.
 */
export function takeToken(b: Bucket, now: number, rate: number, periodMs = 60_000): boolean {
  refill(b, now, rate, periodMs);
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

/**
 * Whole seconds until the next token, for the `retry-after` header.
 *
 * At least 1: a header of 0 reads as "retry immediately", which is the one
 * thing a caller who just ran out of budget must not do.
 */
export function retryAfterSeconds(b: Bucket, rate: number, periodMs = 60_000): number {
  const needed = Math.max(0, 1 - b.tokens);
  return Math.max(1, Math.ceil((needed * periodMs) / 1000 / rate));
}

/** Bring a bucket's tokens up to date: `rate` tokens per `periodMs`, capped at `rate`. */
function refill(b: Bucket, now: number, rate: number, periodMs: number): void {
  const elapsed = Math.max(0, now - b.last);
  b.tokens = Math.min(rate, b.tokens + (elapsed * rate) / periodMs);
  b.last = now;
}

// One shared bucket for the process. Created lazily so tests can set the rate first.
let bucket: Bucket | null = null;

const HOUR_MS = 3_600_000;
// One bucket per signed-in user id. A full bucket is the same as no bucket, so
// once the map is large the full ones are dropped; that bounds it by the users
// who searched within the last hour.
const userBuckets = new Map<string, Bucket>();
const PRUNE_AT = 10_000;

/** Test seam: forget the budget spent so far, shared and per user. */
export function _resetSemanticBudget(): void {
  bucket = null;
  userBuckets.clear();
}

export type SpendResult = { ok: true } | { ok: false; retryAfter: number; scope: "shared" | "user" };

/**
 * Spend one unit of the caller's budget, or report that it is exhausted.
 * `userId` is the signed-in reader, or undefined for everyone else.
 */
export function spendSemanticBudget(now = Date.now(), userId?: string): SpendResult {
  if (userId !== undefined) return spendUser(userId, now);
  const rpm = config.searchSemanticRpm;
  if (rpm <= 0) return { ok: true }; // 0 disables the gate
  bucket ??= newBucket(rpm, now);
  if (takeToken(bucket, now, rpm)) return { ok: true };
  return { ok: false, retryAfter: retryAfterSeconds(bucket, rpm), scope: "shared" };
}

function spendUser(userId: string, now: number): SpendResult {
  const perHour = config.searchSemanticUserPerHour;
  if (perHour <= 0) return { ok: true }; // 0 disables the gate
  if (userBuckets.size >= PRUNE_AT) pruneFull(now, perHour);
  let b = userBuckets.get(userId);
  if (!b) userBuckets.set(userId, (b = newBucket(perHour, now)));
  if (takeToken(b, now, perHour, HOUR_MS)) return { ok: true };
  return { ok: false, retryAfter: retryAfterSeconds(b, perHour, HOUR_MS), scope: "user" };
}

function pruneFull(now: number, perHour: number): void {
  for (const [id, b] of userBuckets) {
    refill(b, now, perHour, HOUR_MS);
    if (b.tokens >= perHour) userBuckets.delete(id);
  }
}

/** Test seam: how many per-user buckets are held. */
export function _userBucketCount(): number {
  return userBuckets.size;
}
