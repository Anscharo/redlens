import { useEffect, useRef, useSyncExternalStore } from "react";
import type { SearchState } from "../hooks/useSearch";

// Recent search history — deliberately ephemeral. Stored in sessionStorage (not
// localStorage), so it lives only for the tab/session and never leaks across
// visits, and each entry is timestamped and forgotten after an hour. Synced
// across components (the recording site in useSearchInput, the dropdown in
// SearchBar) via a same-tab custom event — sessionStorage is per-tab, so the
// cross-tab `storage` event never applies here.
//
// What counts as a "recent query"? Searching on every keystroke means a naive
// "save every worker call" would store the whole g→go→gov→…→governance chain.
// The 500ms typing-pause debounce plus a "must have produced results" gate does
// the heavy lifting: typing a word in one burst records it once, not per key.
// We deliberately do NOT prefix-collapse the stored list — an earlier version
// did, and it wrongly deleted a genuinely distinct earlier search when the next
// one happened to be a prefix of it (search "amatsu", then "amat", and "amatsu"
// vanished). Exact dedupe only; distinct searches each get their own row.

export interface RecentEntry {
  q: string; // the raw query text, stored verbatim
  t: number; // epoch ms when last searched
  n?: number; // result count at record time (absent on legacy entries)
}

// What the dropdown needs per row: the query and its last result count.
export type RecentSuggestion = Pick<RecentEntry, "q" | "n">;

const KEY = "redline-sky-atlas:recent-searches";
const EVENT = "redline-recent-searches-change";
const MAX = 10; // how many we persist (the dropdown shows the top few)
const TTL_MS = 60 * 60 * 1000; // forget anything older than an hour
const DEBOUNCE_MS = 500; // match analytics: record only once typing settles

function read(): RecentEntry[] {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const cutoff = Date.now() - TTL_MS;
    return parsed
      .filter(
        (e): e is RecentEntry =>
          !!e &&
          typeof (e as RecentEntry).q === "string" &&
          typeof (e as RecentEntry).t === "number" &&
          (e as RecentEntry).t >= cutoff,
      )
      .map((e) => (typeof e.n === "number" ? { q: e.q, t: e.t, n: e.n } : { q: e.q, t: e.t }))
      .slice(0, MAX);
  } catch {
    return [];
  }
}

// Cache the parsed value so getSnapshot returns a stable reference (avoids the
// useSyncExternalStore infinite-loop when JSON.parse yields a fresh array).
let snapshot: RecentEntry[] = read();

// Pure merge used by recordRecent (and unit-tested directly): exact dedupe,
// newest first, capped at MAX. An existing identical query is moved to the
// front with a fresh timestamp and result count. `t`/`n` are passed in (not read
// from the clock / state) so the policy stays pure and deterministic to test.
export function mergeRecent(list: RecentEntry[], raw: string, t: number, n: number): RecentEntry[] {
  const q = raw.trim();
  if (!q) return list;
  const kept = list.filter((e) => e.q !== q);
  return [{ q, t, n }, ...kept].slice(0, MAX);
}

function sameQueries(a: RecentEntry[], b: RecentEntry[]): boolean {
  return a.length === b.length && a.every((e, i) => e.q === b[i].q);
}

function commit(next: RecentEntry[]): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    return;
  }
  snapshot = next;
  window.dispatchEvent(new Event(EVENT));
}

export function recordRecent(raw: string, n: number): void {
  if (!raw.trim()) return;
  commit(mergeRecent(read(), raw, Date.now(), n));
}

export function clearRecent(): void {
  commit([]);
}

// Re-reads storage (which prunes anything past the TTL) and republishes if the
// visible list changed. Called when the dropdown is about to open so a query
// that aged out without any new search still disappears.
export function refreshRecent(): void {
  const fresh = read();
  if (sameQueries(fresh, snapshot)) return;
  commit(fresh);
}

function subscribe(cb: () => void): () => void {
  const handler = () => {
    snapshot = read();
    cb();
  };
  // Same-tab sync only: sessionStorage is per-tab and never emits the cross-tab
  // `storage` event, so the custom EVENT is the sole notification channel.
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

// The UI needs the query + its result count; map after the store read so
// getSnapshot keeps returning the stable RecentEntry[] reference.
export function useRecentSearches(): RecentSuggestion[] {
  const entries = useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
  return entries.map((e) => ({ q: e.q, n: e.n }));
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
    const n = state.hits.length;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => recordRecent(q, n), DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [state, raw]);
}
