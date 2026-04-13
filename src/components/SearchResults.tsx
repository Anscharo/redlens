import { useMemo } from "react";
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
const empty: SearchHit[] = []
export function SearchResults({ state, activeScope, onNavigate, onHintClick }: Props) {
  const allHits = state.status === "done" ? state.hits : empty;
  const hits = useMemo(
    () =>
      activeScope
        ? allHits.filter((h) => h.doc_no === activeScope.doc_no || h.doc_no.startsWith(activeScope.doc_no + "."))
        : allHits,
    [allHits, activeScope]
  );

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto w-full">
        {state.status === "done" && (
          <div
            className="px-4 py-2 text-xs border-b mono"
            style={{ color: "var(--tan-3)", borderColor: "var(--border)" }}
          >
            {hits.length === 0
              ? `no results for "${state.query}"${activeScope ? ` in ${activeScope.doc_no}` : ""}${activeScope && allHits.length > 0 ? ` (${allHits.length} in other scopes)` : ""}`
              : `${hits.length}${allHits.length !== hits.length ? ` of ${allHits.length}` : ""} result${hits.length !== 1 ? "s" : ""}${activeScope ? ` in ${activeScope.doc_no}` : ""} · ${state.durationMs.toFixed(0)}ms`}
          </div>
        )}
        {hits.length > 0 && (
          <ul>
            {hits.map((hit) => (
              <li key={hit.id}>
                <SearchResult hit={hit} onNavigate={onNavigate} />
              </li>
            ))}
          </ul>
        )}
        {(state.status === "idle" || state.status === "loading") && <SearchHints onSearch={onHintClick} />}
        {state.status === "error" && (
          <div className="flex items-center justify-center py-24 text-sm" style={{ color: "var(--red)" }}>
            {state.message}
          </div>
        )}
      </div>
    </main>
  );
}
