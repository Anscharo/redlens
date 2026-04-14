import type { RefObject } from "react";
import type { AtlasNode } from "../types";

interface Props {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  ready: boolean;
  isSearching: boolean;
  scopes: AtlasNode[];
  activeScope: AtlasNode | null;
  onToggleScope: (scope: AtlasNode) => void;
}

export function SearchBar({
  inputRef,
  query,
  onChange,
  ready,
  isSearching,
  scopes,
  activeScope,
  onToggleScope,
}: Props) {
  return (
    <header className="search-header shrink-0 px-4 pt-3 pb-2 border-b">
      {/* Single row on tablet+, two rows on phone */}
      <div className="flex flex-wrap sm:flex-nowrap items-center gap-x-2 gap-y-2">
        <a href={import.meta.env.BASE_URL} className="shrink-0" title="Home">
          <img src={`${import.meta.env.BASE_URL}icon-SMALL.png`} alt="Home" width="28" height="28" className="w-7 h-7 object-cover rounded-[30%]" />
        </a>

        {/* Input stretches to fill available space */}
        <div className="relative flex-1 min-w-0">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none text-gray"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <circle cx={11} cy={11} r={8} />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={onChange}
            placeholder={ready ? "Search the Sky Atlas…" : "Loading index…"}
            disabled={!ready}
            className="search-input w-full pl-9 pr-4 py-2 text-sm rounded border disabled:opacity-40 disabled:cursor-wait"
          />
          {isSearching && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs animate-pulse mono text-gray">
              searching…
            </span>
          )}
        </div>

        {/* Scope pills — same row on tablet+, own row on phone */}
        {scopes.length > 0 && (
          <div className="flex items-center gap-1.5 w-full sm:w-auto flex-wrap">
            <span className="mono text-xs shrink-0 text-tan-3">IN</span>
            {scopes.map((s) => {
              const active = activeScope?.id === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => onToggleScope(s)}
                  data-active={active ? "true" : undefined}
                  className="scope-pill mono text-xs px-2 py-0.5 rounded"
                  title={s.title}
                >
                  {s.doc_no}
                </button>
              );
            })}
            {activeScope && (
              <span className="mono text-xs ml-1 hidden sm:inline text-tan-3">
                {activeScope.title}
              </span>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
