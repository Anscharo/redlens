import { ALT_KEY } from "./platform";

// Copy for the footer's contextual hints, keyed by the `data-mod-hint` /
// `data-focus-hint` attribute the call site carries. Kept in one file so the
// two tiers can be read side by side and so adding a gesture is a one-line
// change here plus one attribute at the site — see useContextHints.

/** Focus tier: something that responds to the keyboard holds focus. */
export const FOCUS_HINTS: Readonly<Record<string, string>> = Object.freeze({
  tree: "↑↓←→ Enter (+ Shift) to navigate",
  "search-recents": "↑↓ to browse recent searches · Enter to run",
  search: "Enter → jump to first result",
  "reader-row": "Enter / Space → open",
});

/** Hover tier: the pointer is over something a modifier-click changes. */
export const HOVER_HINTS: Readonly<Record<string, string>> = Object.freeze({
  split: "Shift-click → open in Splitview",
  cascade: "Shift-click → expand 3 levels",
  "cascade-collapse": "Shift-click → collapse all below",
  pendulum: `${ALT_KEY}-click → reverse direction`,
  subtree: "Shift-click → select everything beneath",
});

/**
 * Marks an element as publishing its own focus hint, so the delegated listener
 * leaves the focus tier alone on focusin. Used by the search box, whose hint
 * depends on whether the recents dropdown is open — React state the attribute
 * cannot express, since changing it mid-focus fires no focus event.
 */
export const SELF_MANAGED = "self";
