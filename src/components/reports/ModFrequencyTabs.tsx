import { memo } from "react";

export type ModFrequencyTab = "timeline" | "sum-by" | "list";
export const MOD_FREQUENCY_TABS: readonly ModFrequencyTab[] = ["timeline", "sum-by", "list"];

const TAB_DISPLAY: Record<ModFrequencyTab, string> = {
  timeline: "timeline",
  "sum-by": "sum by",
  list: "list",
};

// Same role="tablist"/role="tab" pattern and .right-tab styling as the reader's
// RightPanel tabs (src/components/atlas/RightPanel.tsx) — the app's one other
// tab bar — so a tab strip reads the same everywhere.
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
