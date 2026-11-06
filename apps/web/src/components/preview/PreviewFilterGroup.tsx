import type { PreviewDiff } from "../../lib/previewDiff";
import { PREVIEW_FILTERS, type PreviewFilterDef, type PreviewFilterGroup as GroupId, type PreviewFilterId } from "../../lib/previewFilters";
import { isLastTicked, tickedFilters } from "../../lib/previewFilterTicks";

export const FILTER_HEADING_CLASS = "px-2 pt-1.5 pb-0.5 text-[10.5px] uppercase tracking-wider text-tan-3";
export const FILTER_ROW_CLASS =
  "w-full flex items-center gap-2 px-2 py-1 rounded text-left hover:bg-hover disabled:opacity-40 disabled:hover:bg-transparent";
export const OLD_BUNDLE_TITLE = "This preview was built before this filter existed";

interface GroupProps {
  group: GroupId;
  label: string;
  diff: PreviewDiff;
  /** The stored selection; which boxes show ticked derives from it. */
  selected: readonly PreviewFilterId[];
  onToggle: (id: PreviewFilterId, on: boolean) => void;
}

/** One filter group in the preview filter menu: a checkbox per filter. */
export function PreviewFilterGroup({ group, label, diff, selected, onToggle }: GroupProps) {
  const ticked = tickedFilters(selected);
  return (
    <fieldset className="mt-1 pt-1" style={{ borderTop: "1px solid var(--border)" }}>
      <legend className={`${FILTER_HEADING_CLASS} float-left w-full`}>{label}</legend>
      {PREVIEW_FILTERS.filter((f) => f.group === group).map((f) => (
        <FilterRow
          key={f.id}
          filter={f}
          ids={f.ids(diff)}
          checked={ticked.includes(f.id)}
          locked={isLastTicked(f.id, selected, diff)}
          onToggle={onToggle}
        />
      ))}
    </fieldset>
  );
}

interface RowProps {
  filter: PreviewFilterDef;
  ids: ReadonlySet<string> | null;
  checked: boolean;
  /** The last ticked box of an exhaustive group, which cannot be unticked. */
  locked: boolean;
  onToggle: (id: PreviewFilterId, on: boolean) => void;
}

// A filter that matches nothing stays listed (greyed) so the menu keeps its
// shape from one preview to the next, and stays clickable so a kind unticked
// at zero can be ticked back.
function FilterRow({ filter, ids, checked, locked, onToggle }: RowProps) {
  const disabled = !ids || locked;
  return (
    <label
      className={`${FILTER_ROW_CLASS} ${!ids || ids.size === 0 ? "opacity-40" : ""} ${disabled ? "" : "cursor-pointer"}`}
      title={ids ? filter.description : OLD_BUNDLE_TITLE}
    >
      <input
        type="checkbox"
        className="shrink-0 accent-accent"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onToggle(filter.id, e.target.checked)}
      />
      <span className="w-3 shrink-0 text-center mono text-tan-3" aria-hidden="true">
        {filter.glyph}
      </span>
      <span className="flex-1 truncate">{filter.label}</span>
      <span className="mono text-tan-3 shrink-0">{ids ? ids.size : "–"}</span>
    </label>
  );
}
