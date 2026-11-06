import type { ComponentProps } from "react";
import type { PreviewFilterPreset as Preset } from "../../lib/previewFilters";
import { FILTER_ROW_CLASS, OLD_BUNDLE_TITLE } from "./PreviewFilterGroup";

interface PresetProps extends Omit<ComponentProps<"button">, "children"> {
  preset: Preset;
  /** Docs the preset keeps; null when this bundle cannot answer it. */
  count: number | null;
  current: boolean;
}

/** One preset row in the preview filter menu: a dot when it is the current
 *  filter, its name, and the count it would show. */
export function PreviewFilterPreset({ preset, count, current, ...props }: PresetProps) {
  return (
    <button
      type="button"
      className={FILTER_ROW_CLASS}
      aria-pressed={current}
      disabled={count === null}
      title={count === null ? OLD_BUNDLE_TITLE : preset.description}
      {...props}
    >
      <span className="w-3 shrink-0 text-accent" aria-hidden="true">
        {current ? "●" : ""}
      </span>
      <span className="flex-1 truncate">{preset.label}</span>
      <span className="mono text-tan-3 shrink-0">{count ?? "–"}</span>
    </button>
  );
}
