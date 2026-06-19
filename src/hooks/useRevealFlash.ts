import { useEffect, useRef, useState } from "react";

// Kept in sync with the --change-flash-ms CSS variable; falls back to 600 ms.
const CHANGE_FLASH_MS = (() => {
  if (typeof window === "undefined") return 600;
  const v = getComputedStyle(document.documentElement).getPropertyValue("--change-flash-ms").trim();
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 600;
})();

// Hold off this long after a row is revealed before flashing it, so the flash
// lands once the row has settled into place rather than mid-reveal.
const CHANGE_FLASH_DELAY_MS = 210;

const EMPTY: ReadonlySet<string> = new Set();

// A changed/new doc is "tree-visible" when every ancestor on its path is expanded.
function isTreeVisible(
  id: string,
  parentOf: Map<string, string | null>,
  expandedIds: Set<string>,
): boolean {
  let pid = parentOf.get(id) ?? null;
  while (pid) {
    if (!expandedIds.has(pid)) return false;
    pid = parentOf.get(pid) ?? null;
  }
  return true;
}

// Returns the set of changed/new doc ids that should currently flash because they
// just became visible (an ancestor expanded — manual toggle, keyboard, or the
// staggered pill reveal). The caller applies an `is-change-flash` class to those
// rows. NOT triggered by scrolling a virtualized row into view, and it never
// selects the row.
//
// The flash is React state, NOT a direct DOM class mutation: the reveal cascade
// fires an expandedIds update per generation (~180ms apart), which re-renders
// rows and lets react-window recycle DOM elements to different nodes. A class
// poked onto a recycled element would be stripped or land on the wrong row — so
// the flash must be keyed to the node id in render, not to a DOM element.
//
// Baseline: the visible set is re-recorded WITHOUT flashing on first activation
// and whenever `flashIds` changes (the diff.json fetch resolving after the tree
// bundle is a data arrival, not a reveal — flashing then would light up every
// already-visible change at once). Only an expandedIds change with a stable
// flashIds set produces flashes.
//
// Timers: start timers (the reveal delay) live in `timers` for bulk cleanup; end
// timers (flash duration) are also tracked per-id in `endTimers` so a re-reveal
// of the same doc cancels the previous end timer instead of being cut short by
// it. Everything is drained on unmount AND on deactivation.
export function useRevealFlash(
  flashIds: Set<string>,
  parentOf: Map<string, string | null>,
  expandedIds: Set<string>,
  active: boolean,
): ReadonlySet<string> {
  const [flashing, setFlashing] = useState<ReadonlySet<string>>(EMPTY);
  const prevVisible = useRef<Set<string>>(new Set());
  const primed = useRef(false);
  const lastFlashIds = useRef<Set<string> | null>(null);
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const endTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const pending = timers.current;
    const ends = endTimers.current;
    return () => {
      for (const t of pending) clearTimeout(t);
      pending.clear();
      ends.clear();
    };
  }, []);

  useEffect(() => {
    if (!active) {
      // Drain everything and reset the baseline so re-entering the tree (e.g.
      // leaving the "changed only" filter) neither leaves stray timers running
      // nor flashes the whole set at once on reactivation.
      for (const t of timers.current) clearTimeout(t);
      timers.current.clear();
      endTimers.current.clear();
      prevVisible.current = new Set();
      primed.current = false;
      lastFlashIds.current = null;
      setFlashing((prev) => (prev.size ? EMPTY : prev));
      return;
    }

    const nowVisible = new Set<string>();
    for (const id of flashIds) {
      if (isTreeVisible(id, parentOf, expandedIds)) nowVisible.add(id);
    }

    // Re-baseline (no flash) on first activation or when the change set itself
    // changes — only a reveal (expandedIds change) with a stable flashIds flashes.
    if (!primed.current || lastFlashIds.current !== flashIds) {
      primed.current = true;
      lastFlashIds.current = flashIds;
      prevVisible.current = nowVisible;
      return;
    }

    const newly: string[] = [];
    for (const id of nowVisible) if (!prevVisible.current.has(id)) newly.push(id);
    prevVisible.current = nowVisible;
    if (!newly.length) return;

    for (const id of newly) {
      const start = setTimeout(() => {
        timers.current.delete(start);
        // A re-reveal within the flash window: cancel the in-flight end timer so
        // it can't truncate the restarted flash.
        const staleEnd = endTimers.current.get(id);
        if (staleEnd) {
          clearTimeout(staleEnd);
          timers.current.delete(staleEnd);
          endTimers.current.delete(id);
        }
        setFlashing((prev) => {
          if (prev.has(id)) return prev;
          const next = new Set(prev);
          next.add(id);
          return next;
        });
        const end = setTimeout(() => {
          timers.current.delete(end);
          endTimers.current.delete(id);
          setFlashing((prev) => {
            if (!prev.has(id)) return prev;
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        }, CHANGE_FLASH_MS);
        timers.current.add(end);
        endTimers.current.set(id, end);
      }, CHANGE_FLASH_DELAY_MS);
      timers.current.add(start);
    }
  }, [flashIds, parentOf, expandedIds, active]);

  return active ? flashing : EMPTY;
}
