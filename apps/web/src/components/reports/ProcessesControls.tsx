// The Processes report's controls row: ProcessesFilters bound to the report's
// URL-synced filter state and local ignore marks.
import type { useProcessesState } from "./useProcessesState";
import { ProcessesFilters } from "./ProcessesFilters";

export function ProcessesControls({ state: s }: { state: ReturnType<typeof useProcessesState> }) {
  return (
    <ProcessesFilters
      marks={s.ignores.marks}
      onClearMarks={s.ignores.clear}
      showIgnored={s.showIgnored}
      onToggleShowIgnored={s.toggleShowIgnored}
      categories={s.categories}
      category={s.category}
      onCategory={s.toggleCategory}
      status={s.status}
      onStatus={s.toggleStatus}
      shape={s.shape}
      onShape={s.toggleShape}
    />
  );
}
