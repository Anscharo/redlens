import { SearchResult } from "./SearchResult";
import { PAGE_SIZE, useSearchResults } from "./SearchResultsContext";
import { useResultClickTracking } from "../hooks/useResultClickTracking";

export function SearchResultsList() {
  const { state, hits, displayed } = useSearchResults();
  const onResultClick = useResultClickTracking(state, hits.length);
  if (displayed.length === 0) return null;
  return (
    <ul>
      {displayed.map((hit, i) => (
        <li key={hit.id}>
          <SearchResult hit={hit} rank={i} onResultClick={onResultClick} />
        </li>
      ))}
    </ul>
  );
}

export function SearchResultsMore() {
  const { remaining, showMore } = useSearchResults();
  if (remaining <= 0) return null;
  return (
    <div className="px-4 py-4 text-center">
      <button onClick={showMore} className="load-more-btn text-xs mono px-3 py-1.5 rounded">
        show {Math.min(remaining, PAGE_SIZE)} more ({remaining} remaining)
      </button>
    </div>
  );
}
