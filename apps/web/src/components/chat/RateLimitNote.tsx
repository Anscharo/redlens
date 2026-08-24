import { humanizeReset } from "./LimitsMeter";
import type { RateLimitState } from "./types";

// Panel-level lock notice shown above the composer while a 429 is in force.
// Three gates, three stories (see chat.ts: "rate_limited", "commons_exhausted",
// "too_many_concurrent"): the per-user token window lifts at a known instant,
// so this just counts down; the shared commons pool has no fixed reset, so it
// offers a manual recheck instead; the per-user concurrency cap has no signal
// to wait on at all — it clears itself as soon as one of the user's own
// in-flight turns finishes — so it just says to wait a moment. ChatPanel owns
// the actual unlock logic (timers/polling) — this component only ever
// describes the current lock, it never clears it.
export function RateLimitNote({ rateLimit, onRecheck }: { rateLimit: RateLimitState; onRecheck: () => void }) {
  return (
    <div className="rlc-ratelimit" role="alert">
      <div className="rlc-ratelimit-head">
        <span className="rlc-ratelimit-dot" aria-hidden="true" />
        <span className="rlc-ratelimit-text">{rateLimit.message}</span>
      </div>
      <div className="rlc-ratelimit-sub">
        {rateLimit.kind === "token" && rateLimit.resetsAt ? (
          <span>You can send again in {humanizeReset(rateLimit.resetsAt)}.</span>
        ) : rateLimit.kind === "concurrent" ? (
          <span>Wait for your other in-progress request to finish, then try again.</span>
        ) : (
          <>
            <span>Shared pool — waiting for it to be topped up.</span>
            <button className="rlc-ratelimit-recheck" onClick={onRecheck}>
              Check now
            </button>
          </>
        )}
      </div>
    </div>
  );
}
