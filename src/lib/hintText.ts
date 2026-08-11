import { ALT_KEY } from "./platform";
import { CASCADE_LEVELS } from "./treeCascade";

// Copy for the footer's contextual hints, keyed by the `data-mod-hint` /
// `data-focus-hint` attribute the call site carries. Kept in one file so the
// two tiers can be read side by side and so adding a gesture is a one-line
// change here plus one attribute at the site — see useContextHints.
//
// [Square brackets] mark a key you press; FooterHint draws each one as a
// keycap. Marking them explicitly, rather than sniffing the text for key-ish
// characters, is what lets "→" stay the plain "leads to" separator in
// "[Enter] → jump to first result" while the [←] and [→] a line above are keys.

/** Focus tier: something that responds to the keyboard holds focus. */
export const FOCUS_HINTS: Readonly<Record<string, string>> = {
  tree: "[↑][↓][←][→] [Enter] (+ [Shift]) to navigate",
  "search-recents": "[↑][↓] to browse recent searches · [Enter] to run",
  search: "[Enter] → jump to first result",
  // The reader's row keys act on what the row currently is, so it names all
  // three outcomes rather than promising "open" to a row that would close.
  "reader-row-open": "[Enter] / [Space] → open",
  "reader-row-show": "[Enter] / [Space] → show the text",
  "reader-row-hide": "[Enter] / [Space] → hide the text",
};

/**
 * The same sentence without its key markers, for places that can only take a
 * plain string — a native `title=`, an aria-label. Lets those share one source
 * with the footer instead of keeping a second, drifting copy of the wording.
 */
export const plainHint = (hint: string): string => hint.replace(/[[\]]/g, "");

/** Hover tier: the pointer is over something a modifier-click changes. */
export const HOVER_HINTS: Readonly<Record<string, string>> = {
  split: "[Shift]-click → open in Splitview",
  cascade: `[Shift]-click → expand ${CASCADE_LEVELS} levels`,
  "cascade-collapse": "[Shift]-click → collapse all below",
  pendulum: `[${ALT_KEY}]-click → reverse direction`,
  subtree: "[Shift]-click → select everything beneath",
};
