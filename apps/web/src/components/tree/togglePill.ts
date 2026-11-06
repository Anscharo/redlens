import type { CSSProperties } from "react";

// Shared chrome for the filter bar that sits above the tree — used by both
// PreviewTreeToggle ("All" + the change-filter menu) and SelectionTreeToggle
// ("All ⇄ Selected · n"). Kept in one place so the bar + active-pill visual
// language can't drift between the two (they occupy the same slot).
export const TREE_TOGGLE_BAR_CLASS = "relative flex items-center gap-1 px-2 py-2 text-[12.5px] mono shrink-0";

/** The bar lifts onto --surface while a filter narrows the tree, so a
 *  filtered tree never reads as the whole atlas. */
export function treeToggleBarStyle(filtered: boolean): CSSProperties {
  return {
    borderBottom: "1px solid var(--border)",
    background: filtered ? "var(--surface)" : undefined,
  };
}

export const TREE_TOGGLE_PILL_CLASS = "px-2 py-1 rounded";

export function togglePillStyle(active: boolean, color: string): CSSProperties {
  return {
    color: active ? color : "var(--tan-3)",
    background: active ? "var(--hover)" : "transparent",
    fontWeight: active ? 600 : 400,
    // A transparent border when inactive keeps the pill the same size.
    border: `1px solid ${active ? "var(--accent)" : "transparent"}`,
  };
}
