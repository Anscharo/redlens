import { useLocation } from "wouter";
import { SearchBar, SearchField, SearchScopeChip } from "./SearchBar";
import { SearchCombobox, SearchComboboxInput, SearchComboboxSuggestions } from "./SearchCombobox";
import { SearchClear } from "./SearchClear";
import { SearchIcon } from "./SearchIcon";
import { SearchModePills } from "./SearchModePills";
import { SearchScopeButton } from "./SearchScopeButton";
import { REPORT_SCOPE_CONFIG, SCOPE_CONFIG, type SearchScope } from "@/lib/routes";
import type { SearchInput } from "../hooks/useSearchInput";

// All three mode pills describe how a STRING is matched, and the meaning lane
// matches no strings — see SearchStatusLine's note, which says the same thing
// about syntax the reader has already typed.
const MEANING_LANE_MODES_OFF = "Broad / phrase / strict apply to wording search — the meaning lane scores whole documents";

interface ShellSearchProps {
  /** The search box's state and handlers (`useSearchInput`). */
  search: SearchInput;
  /** What the box searches on this route: the atlas, or a page's own rows. */
  scope: SearchScope;
  /** Enter on a typed query; true when it was handled. */
  onSubmit: () => boolean;
}

/**
 * The app shell's search row, assembled from the search parts for the current
 * route. On a report page the chip names the report and the box filters its
 * rows; the mode pills show where the box matches strings (the atlas and the
 * reports), and the `in:` button where there is a doc_no subtree to scope to.
 */
export function ShellSearch({ search, scope, onSubmit }: ShellSearchProps) {
  const [location] = useLocation();
  const reportCfg = REPORT_SCOPE_CONFIG[location];
  const cfg = reportCfg ?? SCOPE_CONFIG[scope];
  return (
    <SearchBar>
      <SearchCombobox query={search.query} recentSearches={search.recentSearches} onRecentSelect={search.selectRecent} onSubmit={onSubmit}>
        <SearchField data-scope={scope}>
          <SearchIcon />
          {scope !== "atlas" && <SearchScopeChip>{cfg.label}</SearchScopeChip>}
          <SearchComboboxInput ref={search.inputRef} value={search.query} onChange={search.handleChange} aria-label={`Filter ${cfg.label}`} placeholder={cfg.placeholder} />
          <SearchClear onClick={search.clearQuery} />
        </SearchField>
        <SearchComboboxSuggestions />
      </SearchCombobox>
      {(scope === "atlas" || !!reportCfg) && (
        <SearchModePills
          mode={search.activeMode}
          isMixed={search.isMixed}
          onSetMode={search.wrapModeClick}
          disabledReason={search.lane === "semantic" ? MEANING_LANE_MODES_OFF : undefined}
        />
      )}
      {scope === "atlas" && (
        <SearchScopeButton scopeDoc={search.inScope.scopeDoc} scoped={search.inScope.scoped} onToggle={search.inScope.toggleScope} />
      )}
    </SearchBar>
  );
}
