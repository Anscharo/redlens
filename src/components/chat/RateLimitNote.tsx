import { humanizeReset } from "./UsageNote";
import type { RateLimitState } from "./types";

// Panel-level lock notice shown above the composer while a 429 is in force.
// Two gates, two stories (see chat.ts: "rate_limited" vs "commons_exhausted"):
// the per-user token window lifts at a known instant, so this just counts down;
// the shared commons pool has no fixed reset, so it offers a manual recheck
// instead. ChatPanel owns the actual unlock logic (timers/polling) — this
// component only ever describes the current lock, it never clears it.
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
