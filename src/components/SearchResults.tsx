import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "./Link";
import { SearchResult } from "./SearchResult";
import { SearchHints } from "./SearchHints";
import type { SearchHit, GraphEntity } from "../types";
import type { SearchState } from "../hooks/useSearch";
import type { SearchMode } from "../hooks/useSearchInput";
import { useUrlState, urlInt } from "../hooks/useUrlState";
import { useScrollRestore } from "../hooks/useScrollRestore";
import { loadGraph } from "../lib/graph";
import { useSearchTracking } from "../hooks/useSearchTracking";
import { track } from "../lib/analytics";
import { matchParticipants, buildParticipantLinks } from "../lib/search";
import { ENTITY_TYPE_LABEL, ENTITY_TYPE_COLOR, SUBTYPE_LABEL } from "../lib/entityGraph";

interface Props {
  state: SearchState;
  query: string;
  mode: SearchMode;
  onHintClick: (query: string) => void;
  onBroadSearch: (query: string) => void;
}
const PAGE_SIZE = 500;
const ENTITY_CAP = 6;
const empty: SearchHit[] = [];
const visibleCodec = urlInt(PAGE_SIZE);

export const SearchResults = memo(function SearchResults({
  state,
  query,
  mode,
  onHintClick,
  onBroadSearch,
}: Props) {
  const hits = state.status === "done" ? state.hits : empty;
  const [visible, setVisible] = useUrlState("n", visibleCodec);
  // Reset pagination only when the query actually changes. On mount with a restored
  // URL like `/?n=1000` (back-button after "show more"), keep the saved page count.
  const lastQuery = useRef(query);
  useEffect(() => {
    if (lastQuery.current !== query) {
      lastQuery.current = query;
      setVisible(PAGE_SIZE);
    }
  }, [query, setVisible]);

  // Debounced atlas_search (fires after a typing pause; see hook).
  useSearchTracking(state, mode);

  // Track clicking a result: which query, its rank, whether top-5, and how long
  // after the results were shown. shownAt marks when the current result set
  // rendered (reset whenever a new query settles).
  const shownAt = useRef(0);
  const shownQuery = useRef("");
  useEffect(() => {
    if (state.status === "done") {
      shownAt.current = performance.now();
      shownQuery.current = state.query;
    }
  }, [state]);
  const onResultClick = useCallback(
    (hit: SearchHit, rank: number) => {
      track("search_result_click", {
        product: "search",
        result_kind: "doc",
        query: shownQuery.current,
        rank: rank + 1, // 1-based
        in_top_5: rank < 5,
        ms_to_click: Math.round(performance.now() - shownAt.current),
        result_count: hits.length,
        node_id: hit.id,
        doc_type: hit.type,
      });
    },
    [hits.length],
  );

  const [graph, setGraph] = useState<{ participants: GraphEntity[]; edges: import("../types").RelationEdge[] } | null>(null);
  useEffect(() => {
    loadGraph().then((g) => setGraph({ participants: g.participants, edges: g.edges }));
  }, []);

  const participantLinks = useMemo(
    () => (graph ? buildParticipantLinks(graph.participants, graph.edges) : new Map<string, string>()),
    [graph],
  );

  const entityHits = useMemo(() => {
    if (!graph || !query.trim() || query.startsWith("/")) return [];
    return matchParticipants(query, graph.participants)
      .filter(({ participant }) => participantLinks.has(participant.id))
      .slice(0, ENTITY_CAP);
  }, [graph, participantLinks, query]);

  const noResults = state.status === "done" && hits.length === 0;
  // Query is non-broad when mode pill is phrase/strict, or user typed explicit quotes
  const isNonBroad = mode !== "broad" || query.includes('"') || query.includes("'");
  const strippedQuery = query.replace(/["']/g, "").replace(/\s+/g, " ").trim();
  const suggestBroad = noResults && isNonBroad && strippedQuery;
  const suggestFuzzy =
    noResults && !isNonBroad && !query.includes("~")
      ? query
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .map((w) => (w.includes(":") || w.startsWith("-") ? w : `${w}~2`))
          .join(" ")
      : null;

  const displayed = hits.slice(0, visible);
  const remaining = hits.length - displayed.length;

  const scrollRef = useRef<HTMLElement>(null);
  // Wait until results are rendered before restoring — otherwise we'd scroll
  // an empty container and clobber the saved offset.
  useScrollRestore(scrollRef, state.status === "done" && displayed.length > 0);

  return (
    <main ref={scrollRef} className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto w-full">
        {entityHits.length > 0 && (
          <>
            <div className="px-4 py-2 text-xs border-b mono text-tan-3 border-border">
              Agents · Alignment Conservers · Goverance Operators {entityHits.length}
            </div>
            <ul>
              {entityHits.map(({ participant }, i) => (
                <li key={participant.id}>
                  <Link
                    to={participantLinks.get(participant.id)!}
                    className="search-result-link px-4 py-3 flex items-center gap-3"
                    onClick={() =>
                      track("search_result_click", {
                        product: "search",
                        result_kind: "entity",
                        query: shownQuery.current,
                        rank: i + 1, // 1-based, within the entity list
                        in_top_5: i < 5,
                        ms_to_click: Math.round(performance.now() - shownAt.current),
                        result_count: entityHits.length,
                        entity_id: participant.id,
                        entity_slug: participant.slug,
                        entity_type: participant.et,
                      })
                    }
                  >
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full shrink-0 mr-3"
                      style={{ background: ENTITY_TYPE_COLOR[participant.et] ?? "var(--entity-fallback)" }}
                    />
                    <span className="text-sm font-semibold text-tan">{participant.name}</span>
                    <span className="mono text-[10px] text-tan-3 ml-4">
                      {ENTITY_TYPE_LABEL[participant.et] ?? participant.et}
                      {participant.st
                        ? ` · ${SUBTYPE_LABEL[participant.st] ?? participant.st}`
                        : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
        {(state.status === "searching" || state.status === "done") && (
          <div className="px-4 py-2 text-xs border-b mono text-tan-3 border-border">
            {state.status === "searching"
              ? "searching…"
              : hits.length === 0
                ? `no results for "${state.query}"`
                : `${displayed.length < hits.length ? `${displayed.length} of ` : ""}${hits.length} result${hits.length !== 1 ? "s" : ""} · ${state.durationMs.toFixed(0)}ms`}
          </div>
        )}
        {suggestBroad && (
          <div className="px-4 py-2 border-b border-border">
            <button
              onClick={() => onBroadSearch(strippedQuery)}
              className="text-xs mono text-tan-3 hover:text-accent"
            >
              try broad: {strippedQuery}
            </button>
          </div>
        )}
        {suggestFuzzy && (
          <div className="px-4 py-2 border-b border-border">
            <button
              onClick={() => onHintClick(suggestFuzzy)}
              className="text-xs mono text-tan-3 hover:text-accent"
            >
              try fuzzy: {suggestFuzzy}
            </button>
          </div>
        )}
        {displayed.length > 0 && (
          <ul>
            {displayed.map((hit, i) => (
              <li key={hit.id}>
                <SearchResult hit={hit} rank={i} onResultClick={onResultClick} />
              </li>
            ))}
          </ul>
        )}
        {remaining > 0 && (
          <div className="px-4 py-4 text-center">
            <button
              onClick={() => setVisible((v) => v + PAGE_SIZE)}
              className="load-more-btn text-xs mono px-3 py-1.5 rounded"
            >
              show {Math.min(remaining, PAGE_SIZE)} more ({remaining} remaining)
            </button>
          </div>
        )}
        {(state.status === "idle" || state.status === "loading") && query.startsWith("/") && (
          <SearchHints onSearch={onHintClick} slashFilter={query} />
        )}
        {state.status === "error" && (
          <div className="flex items-center justify-center py-24 text-sm text-red">
            {state.message}
          </div>
        )}
      </div>
    </main>
  );
});
