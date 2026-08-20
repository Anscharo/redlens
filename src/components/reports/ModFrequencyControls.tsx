// Page-level controls for the Modification Frequency report: the ≤/> edit-count
// filter (shared by the Sum By and List tabs, hence page-level) and the tab
// strip. Plus the Timeline tab's granularity picker + chart, which is small
// enough to live beside them.
import {
  FREQUENCY_COMPARATORS,
  FREQUENCY_MIN,
  FREQUENCY_MAX,
} from "@/lib/modFrequencyIndex";
import { CategoryPills } from "./CategoryPills";
import { ModFrequencyTabs, type ModFrequencyTab } from "./ModFrequencyTabs";
import { ModFrequencyTimeline } from "./ModFrequencyTimeline";
import { comparatorDisplay, type useModFrequencyFilter } from "./useModFrequencyFilter";
import { GRANULARITY_DISPLAY, TIMELINE_GRANULARITIES, type useModFrequencyTimeline } from "./useModFrequencyTimeline";

type Filter = ReturnType<typeof useModFrequencyFilter>;
type Timeline = ReturnType<typeof useModFrequencyTimeline>;

export function ModFrequencyControls({
  filter,
  showFilter,
  tab,
  onTab,
}: {
  filter: Filter;
  showFilter: boolean;
  tab: ModFrequencyTab;
  onTab: (t: ModFrequencyTab) => void;
}) {
  return (
    <>
      {showFilter && (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <CategoryPills
            categories={FREQUENCY_COMPARATORS}
            active={filter.comparator}
            onToggle={filter.onComparator}
            label="Show"
            display={comparatorDisplay(filter.threshold)}
          />
          <label className="flex items-center gap-1.5 text-xs text-tan-3">
            Edits
            <input
              type="number"
              min={FREQUENCY_MIN}
              max={FREQUENCY_MAX}
              value={filter.thresholdInput}
              onChange={(e) => filter.setThresholdInput(e.target.value)}
              onBlur={(e) => filter.commitThreshold(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              className="w-14 px-1.5 py-0.5 rounded border bg-transparent mono text-xs text-tan"
              style={{ borderColor: "var(--border)" }}
            />
          </label>
        </div>
      )}
      <ModFrequencyTabs active={tab} onChange={onTab} />
    </>
  );
}

export function ModFrequencyTimelinePanel({ timeline }: { timeline: Timeline }) {
  return (
    <>
      <div className="mb-4">
        <CategoryPills
          categories={TIMELINE_GRANULARITIES}
          active={timeline.granularity}
          onToggle={timeline.onGranularity}
          label="Group by"
          display={GRANULARITY_DISPLAY}
        />
      </div>
      {timeline.buckets ? (
        <ModFrequencyTimeline buckets={timeline.buckets} title={timeline.title} />
      ) : (
        <p className="mono text-xs text-tan-3">No edit timeline available.</p>
      )}
    </>
  );
}
