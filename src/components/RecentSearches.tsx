// Floating dropdown of recent searches, anchored under the search input. Shown
// while the input is focused (see SearchBar). Focus stays on the input (ARIA
// combobox + aria-activedescendant), so options are highlighted via activeIndex
// rather than DOM focus. onMouseDown is preventDefault'd so clicking a row
// doesn't blur the input before the click lands.

interface Props {
  id: string;
  queries: string[];
  activeIndex: number;
  onSelect: (query: string, rank: number) => void;
}

export function RecentSearches({ id, queries, activeIndex, onSelect }: Props) {
  return (
    <div
      id={id}
      className="recent-searches absolute left-0 right-0 top-full mt-1 z-30 rounded border overflow-hidden shadow-lg"
      role="listbox"
      aria-label="Recent searches"
    >
      <p className="px-3 pt-2 pb-1 text-[10px] mono text-tan-3">recent searches</p>
      <ul>
        {queries.map((q, i) => (
          <li key={q}>
            <button
              type="button"
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              onMouseDown={(e) => e.preventDefault()}
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
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
