import { useState, useEffect } from "react";
import { searchEntities, type EntitySearchHit } from "../lib/graph";

const EMPTY: EntitySearchHit[] = [];

/**
 * Entity overlay for the search page. Runs matchParticipants + link resolution
 * in the graph worker (relations.json is already loaded there) and ignores
 * stale replies via the worker request id plus this effect's cancel flag.
 * Failures are swallowed — the overlay is enrichment; doc hits still render.
 */
export function useEntitySearch(query: string): EntitySearchHit[] {
  const [hits, setHits] = useState<EntitySearchHit[]>(EMPTY);
  useEffect(() => {
    const q = query.trim();
    if (!q || q.startsWith("/")) {
      setHits(EMPTY);
      return;
    }
    let cancelled = false;
    void searchEntities(q).then(
      (next) => {
        if (!cancelled) setHits(next);
      },
      () => {
        if (!cancelled) setHits(EMPTY);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [query]);
  return hits;
}
