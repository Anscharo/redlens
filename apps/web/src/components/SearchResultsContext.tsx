import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import type { SearchHit } from "@/types";
import type { SearchLane } from "@/lib/searchSemantic";
import type { SearchState } from "../hooks/useSearch";
import type { SearchMode } from "../hooks/useSearchInput";
import { useUrlState, urlInt } from "../hooks/useUrlState";

export const PAGE_SIZE = 500;
const EMPTY: SearchHit[] = [];
const visibleCodec = urlInt(PAGE_SIZE);

export interface SearchResultsProps {
  state: SearchState;
  query: string;
  mode: SearchMode;
  lane: SearchLane;
  onLaneSelect: (lane: SearchLane) => void;
  onHintClick: (query: string) => void;
  onBroadSearch: (query: string) => void;
}

interface SearchResultsValue extends SearchResultsProps {
  hits: SearchHit[];
  displayed: SearchHit[];
  remaining: number;
  showMore: () => void;
  semanticPending: boolean;
  noResults: boolean;
}

const SearchResultsContext = createContext<SearchResultsValue | null>(null);

export function useSearchResults(): SearchResultsValue {
  const value = useContext(SearchResultsContext);
  if (!value) throw new Error("useSearchResults must be used inside <SearchResultsProvider>");
  return value;
}

export function SearchResultsProvider({
  children,
  state,
  query,
  mode,
  lane,
  onLaneSelect,
  onHintClick,
  onBroadSearch,
}: SearchResultsProps & { children: ReactNode }) {
  const [visible, setVisible] = useUrlState("n", visibleCodec);
  const lastQuery = useRef(query);
  useEffect(() => {
    if (lastQuery.current !== query) {
      lastQuery.current = query;
      setVisible(PAGE_SIZE);
    }
  }, [query, setVisible]);

  const showMore = useCallback(() => setVisible((v) => v + PAGE_SIZE), [setVisible]);
  const hits = state.status === "done" ? state.hits : EMPTY;
  const semanticPending = state.status === "done" && state.semantic === "pending";
  const noResults = state.status === "done" && hits.length === 0 && !semanticPending;
  const displayed = useMemo(() => hits.slice(0, visible), [hits, visible]);

  const value = useMemo(
    () => ({
      state,
      query,
      mode,
      lane,
      onLaneSelect,
      onHintClick,
      onBroadSearch,
      hits,
      displayed,
      remaining: hits.length - displayed.length,
      showMore,
      semanticPending,
      noResults,
    }),
    [state, query, mode, lane, onLaneSelect, onHintClick, onBroadSearch, hits, displayed, showMore, semanticPending, noResults],
  );
  return <SearchResultsContext.Provider value={value}>{children}</SearchResultsContext.Provider>;
}
