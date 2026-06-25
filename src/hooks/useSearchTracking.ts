import { useCallback, useEffect, useRef } from "react";
import type { SearchState } from "./useSearch";
import type { SearchMode } from "./useSearchInput";
import { track } from "../lib/analytics";

// Fires a single `atlas_search` event once the user pauses typing for 900ms (so
// "governance" logs once, not g→go→gov→…), or immediately on unmount when they
// act on a result and navigate away. Deduped by query+mode. `query` is the
// deliberate capture of search text — the input is excluded from autocapture.
const DEBOUNCE_MS = 500;

export function useSearchTracking(state: SearchState, mode: SearchMode): void {
  const lastSent = useRef("");
  const pending = useRef<{ query: string; mode: SearchMode; result_count: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const p = pending.current;
    pending.current = null;
    if (!p) return;
    const key = `${p.query}${p.mode}`;
    if (lastSent.current === key) return;
    lastSent.current = key;
    track("atlas_search", { query: p.query, mode: p.mode, result_count: p.result_count, product: "search" });
  }, []);

  useEffect(() => {
    if (state.status !== "done" || !state.query || state.query.startsWith("/")) return;
    pending.current = { query: state.query, mode, result_count: state.hits.length };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, DEBOUNCE_MS);
  }, [state, mode, flush]);

  // Flush a still-pending search when leaving the results (e.g. clicking a result).
  useEffect(() => () => flush(), [flush]);
}
