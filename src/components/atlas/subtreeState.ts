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

// The reader's single subtree-visibility behavior ("shift-click hides, click a
// hidden branch restores its prior shape"):
//   - plain click toggles expand ⇄ collapse
//   - shift-click hides the branch
//   - clicking a hidden branch restores the shape it had when hidden (if we hold
//     an explicit snapshot), or just expands it if it was only depth-gated
export function nextSubtreeTransition({
  state,
  shiftKey,
  hasExplicitHidden,
}: {
  state: SubtreeVisualState;
  shiftKey: boolean;
  hasExplicitHidden: boolean;
}): SubtreeTransition {
  if (state === "hidden") {
    return hasExplicitHidden ? "restore" : "expanded";
  }
  if (shiftKey) return "hidden";
  return state === "expanded" ? "collapsed" : "expanded";
}
