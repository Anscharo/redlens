import { SearchHints } from "./SearchHints";
import { useSearchResults } from "./SearchResultsContext";

export function SearchSlashHints() {
  const { state, query, onHintClick } = useSearchResults();
  const idle = state.status === "idle" || state.status === "loading";
  if (!idle || !query.startsWith("/")) return null;
  return <SearchHints onSearch={onHintClick} slashFilter={query} />;
}

export function SearchError() {
  const { state } = useSearchResults();
  if (state.status !== "error") return null;
  return <div className="flex items-center justify-center py-24 text-sm text-red">{state.message}</div>;
}
