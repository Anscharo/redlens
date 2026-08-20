import { Link } from "./Link";
import { NavBar, type NavBarProps } from "./NavBar";
import { Tooltip } from "./Tooltip";
import { RecentSearches } from "./RecentSearches";
import { useRecentDropdown } from "../hooks/useRecentDropdown";
import { SCOPE_CONFIG, type ScopeConfig, type SearchScope } from "@/lib/routes";
import type { SearchMode } from "../hooks/useSearchInput";
import type { RecentSuggestion } from "@/lib/recentSearches";
import type { RefObject } from "react";

const MODES: SearchMode[] = ["broad", "phrase", "strict"];
const RECENT_LISTBOX_ID = "recent-search-listbox";
const MAX_SUGGESTIONS = 6;

const MODE_CONFIG: Record<SearchMode, { symbol: string; title: string }> = {
  broad:  { symbol: "a*",  title: "Broad — prefix match on each word, case-insensitive" },
  phrase: { symbol: '"a"', title: "Phrase — exact phrase match, case-insensitive" },
  strict: { symbol: "Aa",  title: "Strict — exact phrase match, case-sensitive" },
};

const MIXED_TOOLTIP = "Advanced mode enabled due to mixed use of quoted and unquoted terms";

interface Props extends NavBarProps {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  mode: SearchMode;
  isMixed: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClear: () => void;
  onSetMode: (mode: SearchMode) => void;
  scope: SearchScope;
  // Route-specific pill override (e.g. a report page's short name). Falls
  // back to the scope's generic config.
  scopeCfg?: ScopeConfig;
  // Show the broad/phrase/strict mode pills. Defaults to atlas scope only;
  // report pages opt in (their filters honor the same mode semantics).
  showModes?: boolean;
  recentSearches?: RecentSuggestion[];
  onRecentSelect?: (query: string, rank: number) => void;
  // Pressing Enter on a typed query (not while picking a recent) calls this;
  // return true if it was handled (e.g. focus jumped to the first result).
  onSubmit?: () => boolean;
}

export function SearchBar({
  inputRef,
  query,
  mode,
  isMixed,
  onChange,
  onClear,
  onSetMode,
  activePage,
  scope,
  scopeCfg,
  showModes,
  recentSearches = [],
  onRecentSelect,
  onSubmit,
}: Props) {
  const cfg = scopeCfg ?? SCOPE_CONFIG[scope];
  const modesVisible = showModes ?? scope === "atlas";

  // Surface recents when the field is empty (incl. the bare quote markers the
  // phrase/strict pills leave behind) OR when what's typed is a prefix of a
  // saved search — then narrow to just the matching ones, typeahead-style. Up
  // to MAX_SUGGESTIONS rows are shown.
  const trimmed = query.trim();
  const trimmedLower = trimmed.toLowerCase();
  const fieldEmpty = trimmed === "" || trimmed === '""' || trimmed === "''";
  const prefix = fieldEmpty ? "" : trimmedLower;
  // Exact-match exclusion is case-insensitive, to match the prefix check — typing
  // "VAT" shouldn't suggest a saved "vat" (it'd run the same search).
  const suggestions = recentSearches
    .filter(({ q }) => {
      const ql = q.toLowerCase();
      return ql !== trimmedLower && ql.startsWith(prefix);
    })
    .slice(0, MAX_SUGGESTIONS);

  const dd = useRecentDropdown({
    suggestions: suggestions.map((s) => s.q),
    query,
    onSelect: onRecentSelect,
  });
  const showRecent = dd.visible && !!onRecentSelect;
  const activeOptionId =
    showRecent && dd.active >= 0 ? `${RECENT_LISTBOX_ID}-opt-${dd.active}` : undefined;

  return (
    <header
      className="search-header shrink-0 px-4 pt-3 pb-2 border-b sticky top-0 z-20"
      style={{ background: "var(--bg)" }}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <Link
          to="/"
          className="order-1 shrink-0 flex items-center justify-center w-7 h-7"
          title="Home"
          aria-label="Home"
          style={{ color: "var(--accent)" }}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 10.5 12 3l9 7.5" />
            <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
            <path d="M9.5 21v-6h5v6" />
          </svg>
        </Link>
        <NavBar activePage={activePage} />

        <div className="order-3 sm:order-2 w-full sm:flex-1 sm:max-w-[680px] flex items-stretch gap-2 min-w-0">
          <div className="relative flex-1 min-w-0">
          <div
            className="search-input-wrap w-full flex items-center rounded border min-w-0"
            data-scope={scope}
          >
            <svg
              className="shrink-0 ml-3 w-4 h-4 pointer-events-none"
              style={{ color: "var(--gray)" }}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle cx={11} cy={11} r={8} />
              <path d="m21 21-4.35-4.35" />
            </svg>

            {scope !== "atlas" && (
              <span className="scope-chip ml-2 shrink-0" aria-hidden="true">
                {cfg.label}
              </span>
            )}

            <input
              ref={inputRef}
              type="search"
              role="combobox"
              aria-label={`Filter ${cfg.label}`}
              aria-expanded={showRecent}
              aria-controls={showRecent ? RECENT_LISTBOX_ID : undefined}
              aria-activedescendant={activeOptionId}
              aria-autocomplete="list"
              value={query}
              onChange={onChange}
              // The footer hint changes while focus stays put, as the dropdown
              // opens and closes under a stationary caret. useContextHints
              // re-reads this attribute when it changes, so it can just carry
              // whichever hint is currently true.
              data-focus-hint={showRecent ? "search-recents" : "search"}
              onFocus={dd.handlers.onFocus}
              // Also open when clicking an already-focused input (no focus event fires then).
              onPointerDown={dd.handlers.onPointerDown}
              // Delay so a mousedown→click on a suggestion still registers before
              // the dropdown unmounts (the option's own onMouseDown also guards).
              onBlur={dd.handlers.onBlur}
              onKeyDown={(e) => {
                dd.handlers.onKeyDown(e);
                // Enter on a typed query the dropdown didn't consume (no recent
                // highlighted) = "I like this search": hand off to onSubmit,
                // which jumps focus to the first result.
                if (e.key === "Enter" && !e.defaultPrevented && onSubmit?.()) e.preventDefault();
              }}
              placeholder={cfg.placeholder}
              autoFocus
              // ph-no-capture: keep typed query text out of PostHog autocapture;
              // search is tracked explicitly via the atlas_search event instead.
              className="search-input ph-no-capture flex-1 min-w-0 px-2 py-2 text-sm"
            />

            <button
              type="button"
              onClick={onClear}
              aria-label="Clear search"
              className={`mr-2 shrink-0 w-5 h-5 flex items-center justify-center rounded text-lg leading-none${query ? "" : " invisible"}`}
              style={{ color: "var(--gray)" }}
            >
              ×
            </button>
          </div>

          {showRecent && (
            <RecentSearches
              id={RECENT_LISTBOX_ID}
              items={suggestions}
              activeIndex={dd.active}
              onSelect={(_q, rank) => dd.select(rank)}
              onHover={dd.onOptionHover}
            />
          )}
          </div>

          {modesVisible && (
            <div className="flex gap-2 shrink-0">
              {MODES.map((m) => {
                const { symbol } = MODE_CONFIG[m];
                const active = !isMixed && mode === m;
                const tooltip = isMixed ? MIXED_TOOLTIP : MODE_CONFIG[m].title;
                return (
                  <Tooltip key={m} content={tooltip}>
                    <span className="flex">
                      <button
                        type="button"
                        onClick={() => onSetMode(m)}
                        aria-label={tooltip}
                        aria-pressed={active}
                        disabled={isMixed}
                        className="mode-pill mono w-8 flex items-center justify-center text-[11px] rounded-sm border disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{
                          color: active ? "var(--tan)" : "var(--gray)",
                          borderColor: active ? "var(--accent)" : "var(--border)",
                          background: active ? "var(--hover)" : "transparent",
                        }}
                      >
                        {symbol}
                      </button>
                    </span>
                  </Tooltip>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
