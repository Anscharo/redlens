import type { CSSProperties } from "react";

// Shared chrome for the "All ⇄ X" pill bar that sits above the tree — used by
// both PreviewTreeToggle ("All ⇄ Changed only") and SelectionTreeToggle
// ("All ⇄ Selected · n"). Kept in one place so the bar + active-pill visual
// language can't drift between the two (they occupy the same slot).
export const TREE_TOGGLE_BAR_CLASS = "flex items-center gap-1 px-2 py-1.5 text-[11px] mono shrink-0";
export const TREE_TOGGLE_BAR_STYLE: CSSProperties = { borderBottom: "1px solid var(--border)" };

export function togglePillStyle(active: boolean, color: string): CSSProperties {
  return {
    color: active ? color : "var(--tan-3)",
    background: active ? "var(--hover)" : "transparent",
    fontWeight: active ? 600 : 400,
  };
}
