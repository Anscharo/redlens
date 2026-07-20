import type { CommonsPool } from "./api";

// The shared "commons" dollar pool — one account-wide balance every signed-in
// user sees. A thin used/remaining bar above the private per-user token meter.
// Turns red under 10% remaining. Hidden entirely when the feature is off.
export function CommonsNote({ commons }: { commons: CommonsPool | null }) {
  if (!commons || !commons.total) return null;
  const usedPct = Math.min(100, Math.round((commons.used / commons.total) * 100));
  const low = commons.remaining <= commons.total * 0.1;
  return (
    <div
      className="rlc-commons"
      title={`Shared pool across all users — $${commons.used.toFixed(2)} used of $${commons.total.toFixed(2)}`}
    >
      <div className="rlc-commons-head">
        <span className="rlc-commons-label">shared credits · all users</span>
        <span className="rlc-commons-val" data-low={low}>
          ${commons.remaining.toFixed(2)} left of ${commons.total.toFixed(2)}
        </span>
      </div>
      <div className="rlc-commons-bar">
        <div className="rlc-commons-fill" data-low={low} style={{ width: `${usedPct}%` }} />
      </div>
    </div>
  );
}
