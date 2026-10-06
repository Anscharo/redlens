import { useCallback, useEffect, useRef } from "react";
import type { SearchHit } from "@/types";
import type { SearchState } from "./useSearch";
import { track } from "../lib/analytics";

export function useResultClickTracking(state: SearchState, resultCount: number) {
  const shownAt = useRef(0);
  const shownQuery = useRef("");
  useEffect(() => {
    if (state.status === "done") {
      shownAt.current = performance.now();
      shownQuery.current = state.query;
    }
  }, [state]);
  return useCallback(
    (hit: SearchHit, rank: number) => {
      track("search_result_click", {
        product: "search",
        result_kind: "doc",
        query: shownQuery.current,
        rank: rank + 1,
        in_top_5: rank < 5,
        ms_to_click: Math.round(performance.now() - shownAt.current),
        result_count: resultCount,
        node_id: hit.id,
        doc_type: hit.type,
      });
    },
    [resultCount],
  );
}
