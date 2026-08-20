import type { RecentSuggestion } from "@/lib/recentSearches";

// Floating dropdown of recent searches, anchored under the search input. Shown
// while the input is focused (see SearchBar). Focus stays on the input (ARIA
// combobox + aria-activedescendant), so options are highlighted via activeIndex
// rather than DOM focus. onMouseDown is preventDefault'd so clicking a row
// doesn't blur the input before the click lands. Each row shows the query and
// the result count it last produced.

interface Props {
  id: string;
  items: RecentSuggestion[];
  activeIndex: number;
  onSelect: (query: string, rank: number) => void;
  onHover: (rank: number) => void;
}

export function RecentSearches({ id, items, activeIndex, onSelect, onHover }: Props) {
  return (
    <div className="recent-searches absolute left-0 right-0 top-full mt-1 z-30 rounded border overflow-hidden shadow-lg">
      {/* aria-hidden: the listbox already carries an accessible name, so this
          visible caption shouldn't be announced as listbox content. */}
      <p aria-hidden="true" className="px-3 pt-2 pb-1 text-[10px] mono text-tan-3">
        recent searches
      </p>
      {/* role="listbox" owns only role="option" children (no ul/li wrappers). */}
      <div id={id} role="listbox" aria-label="Recent searches">
        {items.map(({ q, n }, i) => (
          <button
            key={q}
            type="button"
            id={`${id}-opt-${i}`}
            role="option"
            // Focus stays on the input (aria-activedescendant); keep options
            // out of the tab order so Tab doesn't land on them.
            tabIndex={-1}
            aria-selected={i === activeIndex}
            aria-label={n === undefined ? q : `${q}, ${n} result${n === 1 ? "" : "s"}`}
            onMouseDown={(e) => e.preventDefault()}
            // Hovering makes this the single active row (beats keyboard if later).
            onMouseMove={() => onHover(i)}
            onClick={() => onSelect(q, i)}
            className={`recent-row w-full text-left flex items-center gap-2 px-3 py-2 text-sm${
              i === activeIndex ? " recent-row-active" : ""
            }`}
          >
            <svg
              className="shrink-0 w-3.5 h-3.5"
              style={{ color: "var(--gray)" }}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle cx={12} cy={12} r={9} />
              <path d="M12 7v5l3 2" />
            </svg>
            <span className="truncate">{q}</span>
            {n !== undefined && (
              <span className="ml-auto shrink-0 mono text-[11px] text-tan-3" aria-hidden="true">
                {n.toLocaleString()}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
