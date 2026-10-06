import { SearchStatusLine } from "./SearchStatusLine";
import { SemanticProgress } from "./SemanticProgress";
import { SemanticLoginPrompt } from "./SemanticLoginPrompt";
import { useSearchResults } from "./SearchResultsContext";
import { semanticLaneUsable } from "../lib/semanticSearchConfig";
import { useDataSource } from "../lib/dataSource";

export function SearchResultsStatus() {
  const { state, hits, displayed, semanticPending, lane, onLaneSelect } = useSearchResults();
  const { base } = useDataSource();
  if (state.status !== "searching" && state.status !== "done") return null;
  return (
    <SearchStatusLine
      state={state}
      shown={displayed.length}
      total={hits.length}
      durationMs={state.status === "done" ? state.durationMs : null}
      pending={semanticPending}
      lane={lane}
      onLaneSelect={onLaneSelect}
      semanticAvailable={semanticLaneUsable(base)}
    />
  );
}

export function SearchResultsSemantic() {
  const { state, query, lane, semanticPending } = useSearchResults();
  const waiting = lane === "semantic" && (state.status === "searching" || semanticPending);
  return waiting ? <SemanticProgress key={query} /> : <SemanticLoginPrompt state={state} />;
}
