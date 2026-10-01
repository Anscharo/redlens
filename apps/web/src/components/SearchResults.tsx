import { memo, useCallback, useEffect, useRef } from "react";
import { SearchResult } from "./SearchResult";
import { SearchHints } from "./SearchHints";
import { SearchStatusLine } from "./SearchStatusLine";
import { EntityResults } from "./EntityResults";
import type { SearchHit } from "@/types";
import type { SearchState } from "../hooks/useSearch";
import type { SearchMode } from "../hooks/useSearchInput";
import { useUrlState, urlInt } from "../hooks/useUrlState";
import { useScrollRestore } from "../hooks/useScrollRestore";
import { useSearchTracking } from "../hooks/useSearchTracking";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useEntitySearch } from "../hooks/useEntitySearch";
import { track } from "../lib/analytics";
import { semanticSearchAvailable } from "../lib/semanticSearchConfig";
import type { SearchLane } from "@/lib/searchSemantic";

interface Props {
  state: SearchState;
  query: string;
  mode: SearchMode;
  lane: SearchLane;
  onLaneSelect: (lane: SearchLane) => void;
  onHintClick: (query: string) => void;
  onBroadSearch: (query: string) => void;
}
const PAGE_SIZE = 500;
const empty: SearchHit[] = [];
const visibleCodec = urlInt(PAGE_SIZE);

export const SearchResults = memo(function SearchResults({
  state,
  query,
  mode,
  lane,
  onLaneSelect,
  onHintClick,
  onBroadSearch,
}: Props) {
  useDocumentTitle(query ? `${query} — Sky Atlas by Redline` : null);
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

  // Entities are their OWN lane now, and appear nowhere else. They used to ride
  // above every wording search as an overlay; once the lane existed that became
  // the same list in two places, pushing the document hits down the page on
  // every query that happened to share a word with an actor's name. Passing an
  // empty query off-lane also stops the graph worker doing the matching work at
  // all, rather than matching and then discarding.
  const entitiesOnly = lane === "graph";
  const { hits: entityHits, loading: entitiesLoading } = useEntitySearch(entitiesOnly ? query : "");

  // A leg still in flight is a search still running: the "no results" line and
  // both retry suggestions have to wait for it. Two legs can be in flight, and
  // each needs its own signal — the meaning one reports through the worker's
  // message, the entity one through the graph worker's own loading state.
  const semanticPending = state.status === "done" && state.semantic === "pending";
  // On the entities lane the document hits are computed but never shown, so
  // "nothing found" has to mean nothing in the list the reader is looking at.
  const resultCount = entitiesOnly ? entityHits.length : hits.length;
  const pending = semanticPending || (entitiesOnly && entitiesLoading);
  const noResults = state.status === "done" && resultCount === 0 && !pending;
  // Query is non-broad when mode pill is phrase/strict, or user typed explicit quotes
  const isNonBroad = mode !== "broad" || query.includes('"') || query.includes("'");
  const strippedQuery = query.replace(/["']/g, "").replace(/\s+/g, " ").trim();
  const suggestBroad = noResults && isNonBroad && strippedQuery;
  // A spelling correction the worker already re-ran, so clicking it cannot land
  // on another empty page. This replaced a "try fuzzy: accounting~2" hint, which
  // asked the reader to learn an operator in order to recover from a typo.
  const didYouMean = noResults && state.status === "done" ? state.didYouMean : undefined;

  const displayed = entitiesOnly ? [] : hits.slice(0, visible);
  const remaining = entitiesOnly ? 0 : hits.length - displayed.length;

  const scrollRef = useRef<HTMLElement>(null);
  // Wait until results are rendered before restoring — otherwise we'd scroll
  // an empty container and clobber the saved offset.
  useScrollRestore(
    scrollRef,
    state.status === "done" && (displayed.length > 0 || (entitiesOnly && entityHits.length > 0)),
    ["n"],
  );

  return (
    <main ref={scrollRef} className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto w-full">
        {(state.status === "searching" || state.status === "done") && (
          <SearchStatusLine
            state={state}
            shown={entitiesOnly ? entityHits.length : displayed.length}
            total={resultCount}
            durationMs={entitiesOnly || state.status !== "done" ? null : state.durationMs}
            pending={pending}
            lane={lane}
            onLaneSelect={onLaneSelect}
            semanticAvailable={semanticSearchAvailable()}
          />
        )}
        {entitiesOnly && (
          <EntityResults
            hits={entityHits}
            query={shownQuery.current}
            shownAt={shownAt.current}
            settled={state.status === "done" && !pending}
          />
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
        {didYouMean && (
          <div className="px-4 py-3 border-b border-border text-sm text-tan-2">
            Did you mean{" "}
            <button onClick={() => onHintClick(didYouMean)} className="did-you-mean">
              {didYouMean}
            </button>
            ?
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
