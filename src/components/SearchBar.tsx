import { Link } from "./Link";
import { NavBar, type NavBarProps } from "./NavBar";
import { Tooltip } from "./Tooltip";
import { SCOPE_CONFIG, type SearchScope } from "../lib/routes";
import type { SearchMode } from "../hooks/useSearchInput";
import type { RefObject } from "react";

const MODES: SearchMode[] = ["broad", "phrase", "strict"];

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
}: Props) {
  const cfg = SCOPE_CONFIG[scope];

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
          <div
            className="search-input-wrap flex-1 flex items-center rounded border min-w-0"
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
              aria-label={`Filter ${cfg.label}`}
              value={query}
              onChange={onChange}
              placeholder={cfg.placeholder}
              autoFocus
              className="search-input flex-1 min-w-0 px-2 py-2 text-sm"
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

          {scope === "atlas" && (
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
