import { useEffect, useRef, useSyncExternalStore } from "react";
import type { SearchState } from "../hooks/useSearch";

// Recent search history, persisted per-browser in localStorage and synced across
// components (the recording site in useSearchInput, the dropdown in SearchBar)
// via a custom event + the cross-tab `storage` event — same pattern as usePrefs.
//
// What counts as a "recent query"? Searching on every keystroke means a naive
// "save every worker call" would store the whole g→go→gov→…→governance chain.
// Instead of distance/result-set thresholds, we lean on the fact that
// incremental typing produces a chain of *prefixes*: collapsing any prefix/
// extension pair keeps only the final settled form. Combined with a typing-pause
// debounce and a "must have produced results" gate, the stored list ends up
// being the handful of distinct, productive searches the user actually ran.

const KEY = "redline-sky-atlas:recent-searches";
const EVENT = "redline-recent-searches-change";
const MAX = 10; // how many we persist (the dropdown shows the top few)
const DEBOUNCE_MS = 500; // match analytics: record only once typing settles

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((q): q is string => typeof q === "string").slice(0, MAX);
  } catch {
    return [];
  }
}

// Cache the parsed value so getSnapshot returns a stable reference (avoids the
// useSyncExternalStore infinite-loop when JSON.parse yields a fresh array).
let snapshot: string[] = read();

// Pure merge used by recordRecent (and unit-tested directly): dedupe + prefix-
// collapse, newest first. An exact dupe or a prefix-chain neighbour of the new
// query is dropped before prepending, so "facilitator" replaces the "f"/"fa"/…
// it grew out of instead of stacking 12 partial rows.
export function mergeRecent(list: string[], raw: string): string[] {
  const q = raw.trim();
  if (!q) return list;
  const kept = list.filter(
    (prev) => prev !== q && !q.startsWith(prev) && !prev.startsWith(q),
  );
  return [q, ...kept].slice(0, MAX);
}

function commit(next: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    return;
  }
  snapshot = next;
  window.dispatchEvent(new Event(EVENT));
}

export function recordRecent(raw: string): void {
  if (!raw.trim()) return;
  commit(mergeRecent(read(), raw));
}

export function clearRecent(): void {
  commit([]);
}

function subscribe(cb: () => void): () => void {
  const handler = () => {
    snapshot = read();
    cb();
  };
  window.addEventListener(EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

export function useRecentSearches(): string[] {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

// Records the current search into history once it settles. Fires only on a
// "done" state with ≥1 hit, so zero-result and slash queries never persist; the
// raw input text is stored verbatim so selecting a recent restores exactly what
// the user typed (quotes, field filters and all). Debounced like analytics so a
// burst of keystrokes records the final term, not every intermediate one.
export function useRecordRecentSearch(state: SearchState, raw: string): void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const q = raw.trim();
    const productive = state.status === "done" && state.hits.length > 0;
    if (!productive || !q || q.startsWith("/")) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => recordRecent(q), DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [state, raw]);
}
