import type { SubtreeVisibilityMode } from "./SubtreeVisibilityDemo";

export type SubtreeVisualState = "collapsed" | "expanded" | "hidden";
export type SubtreeTransition = SubtreeVisualState | "restore";

export function deriveSubtreeVisualState({
  hasExplicitHidden,
  hasGatedHidden,
  isExpanded,
}: {
  hasExplicitHidden: boolean;
  hasGatedHidden: boolean;
  isExpanded: boolean;
}): SubtreeVisualState {
  if (hasExplicitHidden || hasGatedHidden) return "hidden";
  return isExpanded ? "expanded" : "collapsed";
}

export function nextSubtreeTransition({
  mode,
  state,
  shiftKey,
  hasExplicitHidden,
}: {
  mode: SubtreeVisibilityMode;
  state: SubtreeVisualState;
  shiftKey: boolean;
  hasExplicitHidden: boolean;
}): SubtreeTransition {
  if (state === "hidden") {
    if (mode === "cycle") return "collapsed";
    if (mode === "shift-hide-restore" && hasExplicitHidden) return "restore";
    return "expanded";
  }
  if (shiftKey && mode !== "cycle") return "hidden";
  if (mode === "cycle") return state === "expanded" ? "hidden" : "expanded";
  return state === "expanded" ? "collapsed" : "expanded";
}
