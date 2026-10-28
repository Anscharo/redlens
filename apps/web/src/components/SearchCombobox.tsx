import { useMemo, type ComponentProps } from "react";
import { useRecentDropdown } from "../hooks/useRecentDropdown";
import { matchingRecents } from "../lib/recentSuggestions";
import type { RecentSuggestion } from "../lib/recentSearches";
import { RECENT_LISTBOX_ID, SearchComboboxContext, useSearchCombobox } from "./searchComboboxContext";

export type SearchComboboxProps = ComponentProps<"div"> & {
  /** The text in the field. */
  query: string;
  /** Saved searches, newest first; those matching what is typed are offered under the field. */
  recentSearches?: RecentSuggestion[];
  /** Picking a recent search: its text and its 0-based rank among those shown. */
  onRecentSelect?: (query: string, rank: number) => void;
  /** Enter on a typed query the dropdown did not consume; return true when it was handled. */
  onSubmit?: () => boolean;
};

/**
 * Root of the search field's ARIA combobox: owns the recent-searches dropdown
 * that `SearchComboboxInput`, `SearchComboboxSuggestions` and `SearchClear`
 * share, and anchors the dropdown under the field.
 */
export function SearchCombobox({ query, recentSearches = [], onRecentSelect, onSubmit, ...props }: SearchComboboxProps) {
  const suggestions = useMemo(() => matchingRecents(recentSearches, query), [recentSearches, query]);
  const dropdown = useRecentDropdown({ suggestions: suggestions.map((s) => s.q), query, onSelect: onRecentSelect });
  const showRecent = dropdown.visible && !!onRecentSelect;
  // Not memoized: the dropdown's state object is new on every render, so a
  // memo here would never hold; the parts re-render with the field anyway.
  const state = { query, suggestions, dropdown, showRecent, onSubmit };
  return (
    <SearchComboboxContext.Provider value={state}>
      <div className="relative flex-1 min-w-0" {...props} />
    </SearchComboboxContext.Provider>
  );
}

export type SearchComboboxInputProps = ComponentProps<"input">;

/**
 * The search text box. Focus stays here while the reader arrows through the
 * recents (the highlighted one is `aria-activedescendant`). The dropdown owns
 * focus, pointer-down and blur; an `onKeyDown` passed in runs after its own.
 */
export function SearchComboboxInput({ onKeyDown, ...props }: SearchComboboxInputProps) {
  const { dropdown, showRecent, onSubmit } = useSearchCombobox();
  return (
    <input
      type="search"
      role="combobox"
      aria-expanded={showRecent}
      aria-controls={showRecent ? RECENT_LISTBOX_ID : undefined}
      aria-activedescendant={showRecent && dropdown.active >= 0 ? `${RECENT_LISTBOX_ID}-opt-${dropdown.active}` : undefined}
      aria-autocomplete="list"
      // The footer hint follows the dropdown opening and closing under a still
      // caret; useContextHints re-reads this attribute when it changes.
      data-focus-hint={showRecent ? "search-recents" : "search"}
      onFocus={dropdown.handlers.onFocus}
      // Opens on a click into an already-focused field, where no focus event fires.
      onPointerDown={dropdown.handlers.onPointerDown}
      // Hides on a delay, so a click on a suggestion lands before it unmounts.
      onBlur={dropdown.handlers.onBlur}
      onKeyDown={(e) => {
        dropdown.handlers.onKeyDown(e);
        onKeyDown?.(e);
        // Enter on a typed query with no recent highlighted is "I like this search".
        if (e.key === "Enter" && !e.defaultPrevented && onSubmit?.()) e.preventDefault();
      }}
      autoFocus
      // ph-no-capture keeps typed text out of PostHog autocapture; the
      // atlas_search event records searches instead.
      className="search-input ph-no-capture flex-1 min-w-0 px-2 py-2 text-sm"
      {...props}
    />
  );
}
