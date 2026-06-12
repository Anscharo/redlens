import type { UsageWindow } from "./api";

function humanizeReset(resetsAt: string): string {
  const ms = Date.parse(resetsAt) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "soon";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.round(mins / 60);
  return `${hrs} hour${hrs === 1 ? "" : "s"}`;
}

// "used N% of your token window · resets in <X>". Dot goes red at ≥80%.
export function UsageNote({ usage }: { usage: UsageWindow | null }) {
  if (!usage || !usage.limit) return null;
  const pct = Math.min(100, Math.round((usage.tokens / usage.limit) * 100));
  const hot = pct >= 80;
  return (
    <div className="rlc-usage">
      <span className="rlc-usage-dot" data-hot={hot} />
      <span className="rlc-usage-text" data-hot={hot}>
        used {pct}% of your token window · resets in {humanizeReset(usage.resetsAt)}
      </span>
    </div>
  );
}
