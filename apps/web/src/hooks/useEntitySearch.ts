import { useState, useEffect } from "react";
import { searchEntities, type EntitySearchHit } from "../lib/graph";

const EMPTY: EntitySearchHit[] = [];

/** Entity hits, plus whether the graph worker is still working on them. */
export interface EntitySearchState {
  hits: EntitySearchHit[];
  /**
   * True from the keystroke until the worker answers. The entities lane is the
   * ONLY thing on screen when it is selected, so without this the page reads
   * "no results for …" — and offers a spelling correction — for the whole time
   * relations.json is loading and matching, on every keystroke. The document
   * search has `state.status` for exactly this; the entity leg had nothing.
   */
  loading: boolean;
}

/**
 * Entity search for the results page. Runs matchParticipants + link resolution
 * in the graph worker (relations.json is already loaded there) and ignores
 * stale replies via the worker request id plus this effect's cancel flag.
 * Failures are swallowed — a failed lookup reads as "found nothing", never as
 * a broken page.
 */
export function useEntitySearch(query: string): EntitySearchState {
  const [state, setState] = useState<EntitySearchState>({ hits: EMPTY, loading: false });
  useEffect(() => {
    const q = query.trim();
    if (!q || q.startsWith("/")) {
      setState({ hits: EMPTY, loading: false });
      return;
    }
    let cancelled = false;
    // Synchronously, before the await: a render between the keystroke and the
    // worker's reply must not be able to observe "done, nothing found".
    setState((prev) => ({ hits: prev.hits, loading: true }));
    void searchEntities(q).then(
      (next) => {
        if (!cancelled) setState({ hits: next, loading: false });
      },
      () => {
        if (!cancelled) setState({ hits: EMPTY, loading: false });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [query]);
  return state;
}
