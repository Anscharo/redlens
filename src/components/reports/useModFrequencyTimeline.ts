import { useState, useEffect, useMemo } from "react";
import { useUrlState, urlEnum } from "../../hooks/useUrlState";
import { track } from "../../lib/analytics";
import {
  loadModTimeline,
  type TimelineGranularity,
  type ModTimelinePeriodRow,
  type ModTimelineCommitRow,
} from "../../lib/history";
import {
  buildModTimelineMonthBuckets,
  buildModTimelineWeekBuckets,
  buildModTimelineCommitBuckets,
} from "../../lib/modFrequencyCharts";

export const TIMELINE_GRANULARITIES: readonly TimelineGranularity[] = ["month", "week", "commit"];
const granularityCodec = urlEnum<TimelineGranularity>("month", TIMELINE_GRANULARITIES);
export const GRANULARITY_DISPLAY: Record<TimelineGranularity, string> = { month: "month", week: "week", commit: "commit" };
const GRANULARITY_TITLE: Record<TimelineGranularity, string> = {
  month: "Semantic edits by month",
  week: "Semantic edits by week",
  commit: "Semantic edits by commit",
};

/** The Timeline tab's month/week/commit chart, URL-synced and fetched
 *  independently of the rest of the report (its own loading state, no
 *  warning banner on failure — see ModFrequencyReport's "No edit timeline
 *  available" fallback). */
export function useModFrequencyTimeline() {
  const [granularity, setGranularity] = useUrlState("tgran", granularityCodec);
  // Manual fetch (not useLoaded, which only ever loads once on mount) so
  // switching granularity re-fetches — loadModTimeline caches per
  // granularity, so flipping back to one already seen resolves instantly.
  //
  // `data` is reset to null synchronously at the top of the effect, before
  // the new fetch even starts, so there's no render where a stale rows array
  // (shaped for the OLD granularity) coexists with the NEW granularity's
  // state — `data` is always either null or in sync with the fetch it came
  // from. Bucket-building below reads `data.granularity` (paired with
  // `data.rows` in the same setData call), not the live `granularity` state,
  // so the two can never mismatch.
  const [data, setData] = useState<{
    granularity: TimelineGranularity;
    rows: (ModTimelinePeriodRow | ModTimelineCommitRow)[] | null;
  } | null>(null);
  useEffect(() => {
    let live = true;
    setData(null);
    loadModTimeline(granularity).then((rows) => {
      if (live) setData({ granularity, rows });
    });
    return () => {
      live = false;
    };
  }, [granularity]);

  const buckets = useMemo(() => {
    if (!data || !data.rows) return null;
    const { rows } = data;
    // Cast is safe by construction: `rows` was fetched for `data.granularity`,
    // which determines the server's row shape.
    if (data.granularity === "week") return buildModTimelineWeekBuckets(rows as ModTimelinePeriodRow[]);
    if (data.granularity === "commit") return buildModTimelineCommitBuckets(rows as ModTimelineCommitRow[]);
    return buildModTimelineMonthBuckets(rows as ModTimelinePeriodRow[]);
  }, [data]);

  const onGranularity = (g: TimelineGranularity) => {
    setGranularity(g);
    track("report_filter", { report: "mod-frequency", filter_type: "timeline_granularity", value: g, active: g !== "month" });
  };

  return { granularity, onGranularity, buckets, title: GRANULARITY_TITLE[granularity] };
}
