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
    <header
      className="shrink-0 px-4 pt-3 pb-2 border-b"
      style={{ background: "var(--bg)", borderColor: "var(--border)" }}
    >
      <div className="max-w-2xl mx-auto lg:max-w-none flex items-center gap-2">
        <a href={import.meta.env.BASE_URL} className="shrink-0" title="Home">
          <img src={`${import.meta.env.BASE_URL}icon-SMALL.png`} alt="Home" className="w-7 h-7 object-cover rounded-[30%]" />
        </a>

        <div className="relative flex-1">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
            style={{ color: "var(--gray)" }}
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
            className="w-full pl-9 pr-4 py-2 text-sm rounded border disabled:opacity-40 disabled:cursor-wait focus:outline-none"
            style={{
              background: "var(--surface)",
              color: "var(--tan)",
              borderColor: "var(--border)",
              fontFamily: "inherit",
            }}
            onFocus={e => (e.target.style.borderColor = "var(--accent)")}
            onBlur={e => (e.target.style.borderColor = "var(--border)")}
          />
          {isSearching && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs animate-pulse mono" style={{ color: "var(--gray)" }}>
              searching…
            </span>
          )}
        </div>
      </div>

      {/* Scope filter pills */}
      {scopes.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2 max-w-2xl mx-auto lg:max-w-none pl-9">
          {scopes.map((s) => {
            const active = activeScope?.id === s.id;
            return (
              <button
                key={s.id}
                onClick={() => onToggleScope(s)}
                className="mono text-xs px-2 py-0.5 rounded border transition-colors"
                style={{
                  background: active ? "var(--red-dim)" : "var(--surface)",
                  color: active ? "var(--tan)" : "var(--tan-3)",
                  borderColor: active ? "var(--red)" : "var(--border)",
                  boxShadow: active ? "inset 2px 0 0 var(--red)" : undefined,
                }}
                onMouseEnter={e => { if (!active) { e.currentTarget.style.borderColor = "var(--depth-1)"; e.currentTarget.style.color = "var(--tan-2)"; }}}
                onMouseLeave={e => { if (!active) { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--tan-3)"; }}}
                title={s.title}
              >
                {s.doc_no}
              </button>
            );
          })}
          {activeScope && (
            <span className="text-xs self-center ml-1" style={{ color: "var(--tan-3)" }}>
              {activeScope.title}
            </span>
          )}
        </div>
      )}
    </header>
  );
}
