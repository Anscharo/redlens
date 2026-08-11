import { useEffect, useState } from "react";
import { hintStore } from "../lib/hintStore";
import { FOCUS_HINTS } from "../lib/hintText";

/**
 * The search box's footer hint. It has two states — arrowing through recent
 * searches, or Enter-to-first-result — and which one applies flips while focus
 * stays put (the dropdown opens and closes under the cursor). A `data-focus-hint`
 * attribute can't express that: changing it mid-focus fires no focus event, so
 * the delegated listener would never re-read it.
 *
 * So the input is marked SELF_MANAGED and owns its hint here instead. That also
 * settles the ordering: useContextHints listens on window, which fires AFTER
 * React has flushed this component's state for the same focus event, so without
 * the opt-out it would land last and overwrite the more specific hint with the
 * generic one.
 *
 * Blur is not handled here — useContextHints clears the tier on focusout for
 * every element, this one included.
 */
export function useSearchFocusHint(showRecent: boolean) {
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) return;
    hintStore.setFocus(FOCUS_HINTS[showRecent ? "search-recents" : "search"]);
  }, [focused, showRecent]);
  return {
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
  };
}
