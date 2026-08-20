import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "wouter";
import type { SearchState } from "./useSearch";
import type { SearchMode } from "./useSearchInput";
import { track } from "../lib/analytics";
import { recordVisit } from "../lib/visitHistory";

// Fires a single `atlas_search` event once the user pauses typing for DEBOUNCE_MS
// (so "governance" logs once, not g→go→gov→…), or immediately on unmount when they
// act on a result and navigate away. Deduped by query+mode. `query` is the
// deliberate capture of search text — the input is excluded from autocapture.
const DEBOUNCE_MS = 500;

export function useSearchTracking(state: SearchState, mode: SearchMode): void {
  const { base } = useRouter(); // "" live / /preview/<id> in preview
  const lastSent = useRef("");
  const pending = useRef<{ query: string; mode: SearchMode; result_count: number; base: string } | null>(null);
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
    // Durable, browser-local cross-session tally (distinct from the ephemeral
    // recentSearches list). Encode the query so `&`/`#`/`?` in it survive URL
    // parsing; recordVisit canonicalizes to /?q=<normalized>.
    void recordVisit({ path: `/?q=${encodeURIComponent(p.query)}`, label: p.query, base: p.base });
  }, []);

  useEffect(() => {
    if (state.status !== "done" || !state.query || state.query.startsWith("/")) return;
    pending.current = { query: state.query, mode, result_count: state.hits.length, base };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, DEBOUNCE_MS);
  }, [state, mode, base, flush]);

  // Flush a still-pending search when leaving the results (e.g. clicking a result).
  useEffect(() => () => flush(), [flush]);
}
