// The budget gate on GET /api/search/semantic.
//
// That route is PUBLIC and UNAUTHENTICATED — the reader's meaning lane has no
// login — and every request that gets past the guards spends real money and
// real database time: one OpenRouter embedding call, a second one for leaf
// attribution whenever a grouped anchor is retrieved (which is nearly always),
// and, for an `in:` scope, an exact pass over every searchable vector. Nothing
// else on this server exposes that cost without a session behind it.
//
// GLOBAL, not per-caller, and deliberately so. Per-IP is the usual shape, but
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
export function takeToken(b: Bucket, now: number, rpm: number): boolean {
  const elapsed = Math.max(0, now - b.last);
  b.tokens = Math.min(rpm, b.tokens + (elapsed * rpm) / 60_000);
  b.last = now;
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
export function retryAfterSeconds(b: Bucket, rpm: number): number {
  const needed = Math.max(0, 1 - b.tokens);
  return Math.max(1, Math.ceil((needed * 60) / rpm));
}

// One bucket for the process. Created lazily so tests can set the rate first.
let bucket: Bucket | null = null;

/** Test seam: forget the budget spent so far. */
export function _resetSemanticBudget(): void {
  bucket = null;
}

/** Spend one unit of the shared budget, or report that it is exhausted. */
export function spendSemanticBudget(now = Date.now()): { ok: true } | { ok: false; retryAfter: number } {
  const rpm = config.searchSemanticRpm;
  if (rpm <= 0) return { ok: true }; // 0 disables the gate
  bucket ??= newBucket(rpm, now);
  if (takeToken(bucket, now, rpm)) return { ok: true };
  return { ok: false, retryAfter: retryAfterSeconds(bucket, rpm) };
}
