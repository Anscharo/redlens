import { memo } from "react";
import { Tooltip } from "../Tooltip";
import type { ModTimelineBucket } from "../../lib/modFrequencyCharts";

// Minimum width per bar so labels stay legible instead of squashing — the
// chart scrolls horizontally (its wrapper) once there are enough buckets to
// exceed the container width. Matters most at commit granularity, which can
// run into the hundreds/thousands of bars.
const MIN_BAR_PX = 26;

const TimelineBar = memo(function TimelineBar({ bucket, max }: { bucket: ModTimelineBucket; max: number }) {
  const heightPct = max > 0 ? (bucket.count / max) * 100 : 0;
  return (
    <Tooltip
      delay={0}
      content={`${bucket.label}: ${bucket.count.toLocaleString()} semantic edit${bucket.count === 1 ? "" : "s"}`}
    >
      <div className="flex flex-col items-center justify-end h-full flex-1 min-w-0">
        <div
          className="w-full rounded-t-sm"
          style={{ height: `${bucket.count > 0 ? Math.max(heightPct, 2) : 0}%`, background: "var(--red)" }}
        />
      </div>
    </Tooltip>
  );
});

// Timeline of semantic edits across the atlas's full recorded history
// (including reconstructed pre-markdown eras), by month, week, or commit —
// `title` names whichever the caller built `buckets` at. Independent of the
// report's rare/frequent filter — this is "when did edits happen", not
// "which docs match the current threshold".
export const ModFrequencyTimeline = memo(function ModFrequencyTimeline({
  buckets,
  title,
}: {
  buckets: readonly ModTimelineBucket[];
  title: string;
}) {
  if (buckets.length === 0) return null;
  const max = Math.max(...buckets.map((b) => b.count));
  const minWidth = buckets.length * MIN_BAR_PX;
  return (
    <div className="mb-6">
      <p className="text-xs mono text-tan-3 mb-2">{title}</p>
      <div className="overflow-x-auto">
        <div className="flex items-end gap-0.5 h-32 border-b border-[var(--border)]" style={{ minWidth }}>
          {buckets.map((b) => (
            <TimelineBar key={b.key} bucket={b} max={max} />
          ))}
        </div>
        <div className="flex gap-0.5 mt-1" style={{ minWidth }}>
          {buckets.map((b) => (
            <div key={b.key} className="flex-1 min-w-0 text-center text-[9px] mono text-tan-3 truncate">
              {b.label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});
