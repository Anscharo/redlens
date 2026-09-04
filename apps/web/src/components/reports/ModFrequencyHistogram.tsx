import { memo } from "react";
import { Tooltip } from "../Tooltip";
import type { ModCountBucket } from "../../lib/modFrequencyCharts";

// One bar. Included (matches the active filter below) renders full-strength
// red; excluded dims to a faint outline — same "highlight what's selected"
// language as SegmentedBar's tail opacity.
const HistogramBar = memo(function HistogramBar({
  bucket,
  max,
  included,
}: {
  bucket: ModCountBucket;
  max: number;
  included: boolean;
}) {
  const heightPct = max > 0 ? (bucket.docs / max) * 100 : 0;
  return (
    <Tooltip
      // Instant, not the 200ms app default: values should appear as the pointer
      // sweeps across bars, without a pause on each one.
      delay={0}
      content={`${bucket.docs.toLocaleString()} doc${bucket.docs === 1 ? "" : "s"} with ${bucket.label} edit${bucket.label === "1" ? "" : "s"}`}
    >
      <div className="flex flex-col items-center justify-end h-full flex-1 min-w-0">
        <div
          className="w-full rounded-t-sm"
          style={{
            height: `${bucket.docs > 0 ? Math.max(heightPct, 2) : 0}%`,
            background: "var(--red)",
            opacity: included ? 1 : 0.25,
          }}
        />
      </div>
    </Tooltip>
  );
});

// Distribution of documents by modification count. `isIncluded` marks the
// bars the active rare/frequent filter below would keep, so the chart doubles
// as a preview of what a given threshold selects.
export const ModFrequencyHistogram = memo(function ModFrequencyHistogram({
  buckets,
  isIncluded,
}: {
  buckets: readonly ModCountBucket[];
  isIncluded: (bucket: ModCountBucket) => boolean;
}) {
  if (buckets.length === 0) return null;
  const max = Math.max(...buckets.map((b) => b.docs));
  return (
    <div className="mb-6">
      <p className="text-xs mono text-tan-3 mb-2">Documents by number of edits</p>
      <div className="flex items-end gap-0.5 h-32 border-b border-[var(--border)]">
        {buckets.map((b) => (
          <HistogramBar key={b.count} bucket={b} max={max} included={isIncluded(b)} />
        ))}
      </div>
      <div className="flex gap-0.5 mt-1">
        {buckets.map((b) => (
          <div key={b.count} className="flex-1 min-w-0 text-center text-[9px] mono text-tan-3 truncate">
            {b.label}
          </div>
        ))}
      </div>
    </div>
  );
});
