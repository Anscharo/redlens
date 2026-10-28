import type { CSSProperties } from "react";

/** The look shared by the small mono buttons beside the search field: the
 *  match-mode pills, the phone's mode-cycle button and the `in:` scope button. */
export const SEARCH_PILL_CLASS =
  "mode-pill mono w-8 flex items-center justify-center text-[11px] rounded-sm border disabled:opacity-40 disabled:cursor-not-allowed";

export function searchPillStyle(active: boolean): CSSProperties {
  return {
    color: active ? "var(--tan)" : "var(--gray)",
    borderColor: active ? "var(--accent)" : "var(--border)",
    background: active ? "var(--hover)" : "transparent",
  };
}
