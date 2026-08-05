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
  // Rows are tagged with the granularity they were fetched for, not just
  // stored bare: `granularity` (state) flips to its new value on the render
  // right after a pill click, one render before this effect's fetch resolves
  // and updates the rows — during that gap, bare stale rows would carry the
  // OLD granularity's shape (e.g. period rows with no `sha`/`seq`) while the
  // buckets memo below reads the NEW granularity, calling the wrong builder
  // on mismatched data. Comparing `data.granularity` against the live
  // `granularity` closes that window instead of racing it.
  const [data, setData] = useState<{
    granularity: TimelineGranularity;
    rows: (ModTimelinePeriodRow | ModTimelineCommitRow)[] | null;
  } | null>(null);
  useEffect(() => {
    let live = true;
    loadModTimeline(granularity).then((rows) => {
      if (live) setData({ granularity, rows });
    });
    return () => {
      live = false;
    };
  }, [granularity]);

  const buckets = useMemo(() => {
    if (!data || data.granularity !== granularity || !data.rows) return null;
    const { rows } = data;
    // Cast is safe by construction: `rows` was fetched for this exact
    // granularity (the check above), which determines the server's row shape.
    if (granularity === "week") return buildModTimelineWeekBuckets(rows as ModTimelinePeriodRow[]);
    if (granularity === "commit") return buildModTimelineCommitBuckets(rows as ModTimelineCommitRow[]);
    return buildModTimelineMonthBuckets(rows as ModTimelinePeriodRow[]);
  }, [data, granularity]);

  const onGranularity = (g: TimelineGranularity) => {
    setGranularity(g);
    track("report_filter", { report: "mod-frequency", filter_type: "timeline_granularity", value: g, active: g !== "month" });
  };

  return { granularity, onGranularity, buckets, title: GRANULARITY_TITLE[granularity] };
}
