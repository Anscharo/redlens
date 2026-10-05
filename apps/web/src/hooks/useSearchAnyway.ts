import { useCallback } from "react";
import type { SearchOptions, SearchState } from "./useSearch";
import type { SearchLane } from "@/lib/searchSemantic";

/**
 * Enter on a meaning query the word-shape check held back: sends it anyway.
 * Returns whether it did, so the caller can fall through to its own Enter
 * behaviour. The forced query is one-off — the next keystroke is judged again.
 */
export function useSearchAnyway(state: SearchState, lane: SearchLane, search: (q: string, opts: SearchOptions) => void) {
  return useCallback((): boolean => {
    if (lane !== "semantic" || state.status !== "done" || !state.heldWords?.length) return false;
    search(state.query, { lane, force: true });
    return true;
  }, [state, lane, search]);
}
