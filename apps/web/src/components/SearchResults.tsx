import { memo, useRef, type ReactNode } from "react";
import { SearchResultsProvider, useSearchResults, type SearchResultsProps } from "./SearchResultsContext";
import { SearchResultsStatus, SearchResultsSemantic } from "./SearchResultsHeader";
import { SearchBroadSuggestion, SearchDidYouMean } from "./SearchResultsSuggestions";
import { SearchResultsList, SearchResultsMore } from "./SearchResultsBody";
import { SearchSlashHints, SearchError } from "./SearchResultsStates";
import { useScrollRestore } from "../hooks/useScrollRestore";
import { useSearchTracking } from "../hooks/useSearchTracking";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

function SearchResultsMain({ children }: { children: ReactNode }) {
  const { state, query, mode, displayed } = useSearchResults();
  const scrollRef = useRef<HTMLElement>(null);
  useDocumentTitle(query ? `${query} — Sky Atlas by Redline` : null);
  useSearchTracking(state, mode);
  useScrollRestore(scrollRef, state.status === "done" && displayed.length > 0, ["n"]);
  return (
    <main ref={scrollRef} className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto w-full">{children}</div>
    </main>
  );
}

export const SearchResults = memo(function SearchResults(props: SearchResultsProps) {
  return (
    <SearchResultsProvider {...props}>
      <SearchResultsMain>
        <SearchResultsStatus />
        <SearchResultsSemantic />
        <SearchBroadSuggestion />
        <SearchDidYouMean />
        <SearchResultsList />
        <SearchResultsMore />
        <SearchSlashHints />
        <SearchError />
      </SearchResultsMain>
    </SearchResultsProvider>
  );
});
