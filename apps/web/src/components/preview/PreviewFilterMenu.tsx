import type { ComponentProps, CSSProperties } from "react";
import { usePreviewDiff } from "../../lib/previewDiff";
import { usePreviewView } from "../../lib/previewView";
import {
  PREVIEW_FILTER_GROUPS,
  PREVIEW_FILTER_IDS,
  PREVIEW_FILTER_PRESETS,
  filterPreviewDocs,
  matchingPreset,
  presetAvailable,
  type PreviewFilterId,
  type PreviewFilterPreset as Preset,
} from "../../lib/previewFilters";
import { track } from "../../lib/analytics";
import { FILTER_HEADING_CLASS, PreviewFilterGroup } from "./PreviewFilterGroup";
import { PreviewFilterPreset } from "./PreviewFilterPreset";

const MENU_STYLE: CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  boxShadow: "0 10px 28px -8px var(--shadow-strong)",
};

/** The preview filter menu: presets (pick one, menu closes), then each
 *  filter group as checkboxes (menu stays open). Every row carries the count
 *  it would show. Rows are read from the previewFilters.ts registry. */
export function PreviewFilterMenu({ onPicked, ...props }: ComponentProps<"div"> & { onPicked: () => void }) {
  const diff = usePreviewDiff();
  const { onlyChanged, changeFilters, setChangeFilters } = usePreviewView();
  const ticked = onlyChanged ? changeFilters : [];
  const current = onlyChanged ? matchingPreset(ticked) : undefined;

  const apply = (next: readonly PreviewFilterId[], via: string) => {
    const ordered = PREVIEW_FILTER_IDS.filter((id) => next.includes(id));
    track("preview_filter_change", { filters: ordered, via, count: filterPreviewDocs(diff, ordered).size });
    setChangeFilters(ordered);
  };
  const toggle = (id: PreviewFilterId, on: boolean) => apply(on ? [...ticked, id] : ticked.filter((f) => f !== id), id);
  const pickPreset = (p: Preset) => (apply(p.filters, `preset:${p.label}`), onPicked());

  return (
    <div className="absolute left-2 right-2 top-full mt-1 z-30 max-w-xs rounded-md p-1 font-sans text-[13px]" style={MENU_STYLE} {...props}>
      <h3 className={FILTER_HEADING_CLASS}>Show</h3>
      {PREVIEW_FILTER_PRESETS.map((p) => (
        <PreviewFilterPreset
          key={p.label}
          preset={p}
          current={current === p}
          count={presetAvailable(p, diff) ? filterPreviewDocs(diff, p.filters).size : null}
          onClick={() => pickPreset(p)}
        />
      ))}
      {PREVIEW_FILTER_GROUPS.map((g) => (
        <PreviewFilterGroup key={g.id} group={g.id} label={g.label} diff={diff} ticked={ticked} onToggle={toggle} />
      ))}
    </div>
  );
}
