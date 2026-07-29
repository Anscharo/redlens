export type SubtreeVisualState = "open" | "closed" | "hidden";
export type SubtreeTransition = SubtreeVisualState | "restore";

// A parent's subtree is in exactly one of three visual states:
//   - "open"   — descendant rows shown AND their bodies expanded
//   - "closed" — descendant rows shown, bodies collapsed (the neutral default)
//   - "hidden" — descendant rows removed from the reader ("hide all children")
export function deriveSubtreeVisualState({
  hidden,
  bodiesOpen,
}: {
  hidden: boolean;
  bodiesOpen: boolean;
}): SubtreeVisualState {
  if (hidden) return "hidden";
  return bodiesOpen ? "open" : "closed";
}

// The reader's single subtree-visibility behavior ("shift-click hides, click a
// hidden branch restores its prior shape"):
//   - plain click toggles open ⇄ closed
//   - shift-click hides the branch
//   - clicking a hidden branch restores the shape it had when hidden (if we hold
//     an explicit snapshot), or just opens it if it was only depth-gated
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
    return hasExplicitHidden ? "restore" : "open";
  }
  if (shiftKey) return "hidden";
  return state === "open" ? "closed" : "open";
}
