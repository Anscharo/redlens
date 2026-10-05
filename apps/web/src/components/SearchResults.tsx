import { memo, useCallback, useEffect, useRef } from "react";
import { SearchResult } from "./SearchResult";
import { SearchHints } from "./SearchHints";
import { SearchStatusLine } from "./SearchStatusLine";
import { SemanticProgress } from "./SemanticProgress";
import { SemanticLoginPrompt } from "./SemanticLoginPrompt";
import type { SearchHit } from "@/types";
import type { SearchState } from "../hooks/useSearch";
import type { SearchMode } from "../hooks/useSearchInput";
import { useUrlState, urlInt } from "../hooks/useUrlState";
import { useScrollRestore } from "../hooks/useScrollRestore";
import { useSearchTracking } from "../hooks/useSearchTracking";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
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

  // A meaning leg still in flight is a search still running: the "no results"
  // line and both retry suggestions have to wait for it.
  const semanticPending = state.status === "done" && state.semantic === "pending";
  const noResults = state.status === "done" && hits.length === 0 && !semanticPending;
  // Query is non-broad when mode pill is phrase/strict, or user typed explicit quotes
  const isNonBroad = mode !== "broad" || query.includes('"') || query.includes("'");
  const strippedQuery = query.replace(/["']/g, "").replace(/\s+/g, " ").trim();
  // Only on the wording lane, the same rule the worker applies to `didYouMean`:
  // the meaning lane drops the quotes before embedding, so re-running the same
  // words "broad" there would send the identical request and get the identical
  // empty answer — the status line says they were ignored instead.
  const suggestBroad = noResults && lane === "lexical" && isNonBroad && strippedQuery;
  // A spelling correction the worker already re-ran, so clicking it cannot land
  // on another empty page. This replaced a "try fuzzy: accounting~2" hint, which
  // asked the reader to learn an operator in order to recover from a typo.
  const didYouMean = noResults && state.status === "done" ? state.didYouMean : undefined;

  const displayed = hits.slice(0, visible);
  const remaining = hits.length - displayed.length;

  const scrollRef = useRef<HTMLElement>(null);
  // Wait until results are rendered before restoring — otherwise we'd scroll
  // an empty container and clobber the saved offset.
  useScrollRestore(scrollRef, state.status === "done" && displayed.length > 0, ["n"]);

  return (
    <main ref={scrollRef} className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto w-full">
        {(state.status === "searching" || state.status === "done") && (
          <SearchStatusLine
            state={state}
            shown={displayed.length}
            total={hits.length}
            durationMs={state.status !== "done" ? null : state.durationMs}
            pending={semanticPending}
            lane={lane}
            onLaneSelect={onLaneSelect}
            semanticAvailable={semanticSearchAvailable()}
          />
        )}
        {/* Keyed on the query so a second search restarts the stages. Usually
            the intervening "searching" state unmounts it anyway, but two
            queries that both settle straight into a pending leg would otherwise
            leave the second one inheriting the first's timer, reading
            "Comparing Results" on a search that just began. */}
        {semanticPending && <SemanticProgress key={query} />}
        <SemanticLoginPrompt state={state} />
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
