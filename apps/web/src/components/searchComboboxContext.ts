import { createContext, useContext } from "react";
import type { useRecentDropdown } from "../hooks/useRecentDropdown";
import type { RecentSuggestion } from "../lib/recentSearches";

/** The recents listbox's id; its options are `${RECENT_LISTBOX_ID}-opt-${rank}`. */
export const RECENT_LISTBOX_ID = "recent-search-listbox";

/** What `SearchCombobox` shares with its input, suggestions and clear button. */
export interface SearchComboboxState {
  /** The text in the field. */
  query: string;
  /** The recent searches offered for what is typed. */
  suggestions: RecentSuggestion[];
  /** Open and highlight state for the recents, and the input handlers that drive it. */
  dropdown: ReturnType<typeof useRecentDropdown>;
  /** Whether the recents listbox is showing. */
  showRecent: boolean;
  /** Enter on a typed query the dropdown did not consume; true when it was handled. */
  onSubmit?: () => boolean;
}

export const SearchComboboxContext = createContext<SearchComboboxState | null>(null);

/** The enclosing `SearchCombobox`'s state. Its parts render nowhere else, so a missing root throws. */
export function useSearchCombobox(): SearchComboboxState {
  const state = useContext(SearchComboboxContext);
  if (!state) throw new Error("SearchCombobox parts must be rendered inside <SearchCombobox>");
  return state;
}
