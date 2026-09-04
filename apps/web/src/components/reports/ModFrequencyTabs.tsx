import { memo } from "react";

export type ModFrequencyTab = "timeline" | "sum-by" | "list";
export const MOD_FREQUENCY_TABS: readonly ModFrequencyTab[] = ["timeline", "sum-by", "list"];

const TAB_DISPLAY: Record<ModFrequencyTab, string> = {
  timeline: "timeline",
  "sum-by": "sum by",
  list: "list",
};

// Exclusive tabs (timeline / sum-by / list). The reader's right panel is a
// jump-pill strip, not a tablist — don't copy its markup here.
export const ModFrequencyTabs = memo(function ModFrequencyTabs({
  active,
  onChange,
}: {
  active: ModFrequencyTab;
  onChange: (tab: ModFrequencyTab) => void;
}) {
  return (
    <div className="flex gap-1 border-b mb-4" style={{ borderColor: "var(--border)" }} role="tablist">
      {MOD_FREQUENCY_TABS.map((t) => (
        <button key={t} role="tab" aria-selected={active === t} onClick={() => onChange(t)} className="right-tab">
          {TAB_DISPLAY[t]}
        </button>
      ))}
    </div>
  );
});
