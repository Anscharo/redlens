import type { RefObject } from "react";
import { Link } from "wouter";

const BASE = import.meta.env.BASE_URL;

interface Props {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  ready: boolean;
  isSearching: boolean;
  onNavPage: (page: 'reports' | 'entities') => void;
  activePage: 'reports' | 'entities' | null;
}

export function SearchBar({ inputRef, query, onChange, ready, isSearching, onNavPage, activePage }: Props) {
  return (
    <header className="search-header shrink-0 px-4 pt-3 pb-2 border-b">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">

        {/* Home icon — row 1 left on mobile, row 1 left on desktop */}
        <Link to="/" className="order-1 shrink-0" title="Home">
          <img src={`${BASE}icon-SMALL.png`} alt="Home" width="28" height="28" className="w-7 h-7 object-cover rounded-[30%]" />
        </Link>

        {/* Nav links — row 1 right on mobile, row 1 right on desktop */}
        <div className="order-2 sm:order-3 flex-1 flex items-center justify-end gap-2">
          <NavLink active={activePage === 'entities'} onClick={() => onNavPage('entities')}>Entity Tree</NavLink>
          <NavLink active={activePage === 'reports'}  onClick={() => onNavPage('reports')}>Reports</NavLink>
        </div>

        {/* Search — row 2 full-width on mobile, row 1 between home and nav on desktop */}
        <div className="order-3 sm:order-2 w-full sm:w-auto sm:flex-1 sm:max-w-[760px] relative min-w-0">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none text-gray"
            fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <circle cx={11} cy={11} r={8} />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={onChange}
            placeholder={ready ? "Search the Atlas or type /hints for query help" : "Loading index…"}
            disabled={!ready}
            className="search-input w-full pl-9 pr-4 py-2 text-sm rounded border disabled:opacity-40 disabled:cursor-wait"
          />
          {isSearching && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs animate-pulse mono text-gray">
              searching…
            </span>
          )}
        </div>

      </div>
    </header>
  );
}

function NavLink({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="nav-link shrink-0 px-3 py-1.5 rounded text-sm"
      data-active={active ? 'true' : undefined}
    >
      {children}
    </button>
  );
}
