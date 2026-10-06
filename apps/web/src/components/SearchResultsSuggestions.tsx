import { useSearchResults } from "./SearchResultsContext";
import { broadSuggestion } from "../lib/searchSuggestions";

export function SearchBroadSuggestion() {
  const { query, mode, lane, noResults, onBroadSearch } = useSearchResults();
  const broad = noResults ? broadSuggestion(query, mode, lane) : null;
  if (!broad) return null;
  return (
    <div className="px-4 py-2 border-b border-border">
      <button onClick={() => onBroadSearch(broad)} className="text-xs mono text-tan-3 hover:text-accent">
        try broad: {broad}
      </button>
    </div>
  );
}

export function SearchDidYouMean() {
  const { state, noResults, onHintClick } = useSearchResults();
  const correction = noResults && state.status === "done" ? state.didYouMean : undefined;
  if (!correction) return null;
  return (
    <div className="px-4 py-3 border-b border-border text-sm text-tan-2">
      Did you mean{" "}
      <button onClick={() => onHintClick(correction)} className="did-you-mean">
        {correction}
      </button>
      ?
    </div>
  );
}
