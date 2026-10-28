import { RecentSearches } from "./RecentSearches";
import { RECENT_LISTBOX_ID, useSearchCombobox } from "./searchComboboxContext";

/** The recent-searches listbox under the field, rendered while the combobox is open. */
export function SearchComboboxSuggestions() {
  const { suggestions, dropdown, showRecent } = useSearchCombobox();
  if (!showRecent) return null;
  return (
    <RecentSearches
      id={RECENT_LISTBOX_ID}
      items={suggestions}
      activeIndex={dropdown.active}
      onSelect={(_q, rank) => dropdown.select(rank)}
      onHover={dropdown.onOptionHover}
    />
  );
}
