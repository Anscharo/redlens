import { memo, useMemo, useState, useEffect } from "react";
import { SearchResult } from "./SearchResult";
import { SearchHints } from "./SearchHints";
import type { AtlasNode, SearchHit } from "../types";
import type { SearchState } from "../hooks/useSearch";

interface Props {
  state: SearchState;
  activeScope: AtlasNode | null;
  onNavigate: (id: string) => void;
  onHintClick: (query: string) => void;
}
const PAGE_SIZE = 500;
const empty: SearchHit[] = [];

export const SearchResults = memo(function SearchResults({ state, activeScope, onNavigate, onHintClick }: Props) {
  const allHits = state.status === "done" ? state.hits : empty;
  const hits = useMemo(
    () =>
      activeScope
        ? allHits.filter((h) => h.doc_no === activeScope.doc_no || h.doc_no.startsWith(activeScope.doc_no + "."))
        : allHits,
    [allHits, activeScope]
  );

  const [visible, setVisible] = useState(PAGE_SIZE);
  useEffect(() => { setVisible(PAGE_SIZE); }, [hits]);

  const displayed = hits.slice(0, visible);
  const remaining = hits.length - displayed.length;

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto w-full">
        {state.status === "done" && (
          <div className="px-4 py-2 text-xs border-b mono text-tan-3 border-border">
            {hits.length === 0
              ? `no results for "${state.query}"${activeScope ? ` in ${activeScope.doc_no}` : ""}${activeScope && allHits.length > 0 ? ` (${allHits.length} in other scopes)` : ""}`
              : `${displayed.length < hits.length ? `${displayed.length} of ` : ""}${hits.length}${allHits.length !== hits.length ? ` of ${allHits.length}` : ""} result${hits.length !== 1 ? "s" : ""}${activeScope ? ` in ${activeScope.doc_no}` : ""} · ${state.durationMs.toFixed(0)}ms`}
          </div>
        )}
        {displayed.length > 0 && (
          <ul>
            {displayed.map((hit) => (
              <li key={hit.id}>
                <SearchResult hit={hit} onNavigate={onNavigate} />
              </li>
            ))}
          </ul>
        )}
        {remaining > 0 && (
          <div className="px-4 py-4 text-center">
            <button
              onClick={() => setVisible(v => v + PAGE_SIZE)}
              className="load-more-btn text-xs mono px-3 py-1.5 rounded"
            >
              show {Math.min(remaining, PAGE_SIZE)} more ({remaining} remaining)
            </button>
          </div>
        )}
        {(state.status === "idle" || state.status === "loading") && <SearchHints onSearch={onHintClick} />}
        {state.status === "error" && (
          <div className="flex items-center justify-center py-24 text-sm text-red">
            {state.message}
          </div>
        )}
      </div>
    </main>
  );
});
