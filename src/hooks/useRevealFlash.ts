import { useEffect, useRef } from "react";
import type { RefObject } from "react";

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

// Flashes changed/new tree rows the moment they become visible because an
// ancestor expanded (manual toggle, keyboard, or the staggered pill reveal). NOT
// triggered by scrolling a virtualized row into view, and it never selects the
// row — it only toggles `is-change-flash` via direct DOM mutation (same trick as
// usePulseDom: keeps the pulse out of rowProps so react-window doesn't re-render
// every row twice). The set of docs visible on first run is the baseline, so the
// initial load doesn't flash everything.
//
// Pending flash timers live in a ref and are cleared only on unmount — NOT on
// every expandedIds change. The staggered reveal fires an expandedIds update per
// generation (~200ms apart); clearing on each change would cancel the prior
// generation's delayed flash before it lands, so only chevron (single-change)
// expansions would ever flash.
export function useRevealFlash(
  flashIds: Set<string>,
  parentOf: Map<string, string | null>,
  expandedIds: Set<string>,
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
): void {
  const prevVisible = useRef<Set<string>>(new Set());
  const primed = useRef(false);
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const t of pending) clearTimeout(t);
      pending.clear();
    };
  }, []);

  useEffect(() => {
    if (!active) {
      // Reset baseline so re-entering the tree (e.g. leaving "changed only"
      // filter) doesn't flash the whole set at once.
      prevVisible.current = new Set();
      primed.current = false;
      return;
    }

    const nowVisible = new Set<string>();
    for (const id of flashIds) {
      if (isTreeVisible(id, parentOf, expandedIds)) nowVisible.add(id);
    }

    if (!primed.current) {
      primed.current = true;
      prevVisible.current = nowVisible;
      return;
    }

    const newly: string[] = [];
    for (const id of nowVisible) if (!prevVisible.current.has(id)) newly.push(id);
    prevVisible.current = nowVisible;
    if (!newly.length) return;

    const container = containerRef.current;
    for (const id of newly) {
      // Look the row up at flash time (after the delay) so freshly-inserted rows
      // are in the DOM by then.
      const start = setTimeout(() => {
        timers.current.delete(start);
        const el = container?.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
        if (!el) return; // virtualized off-screen → not "on screen", skip
        el.classList.remove("is-change-flash");
        void el.offsetWidth; // restart the animation if it was mid-flash
        el.classList.add("is-change-flash");
        const end = setTimeout(() => {
          timers.current.delete(end);
          el.classList.remove("is-change-flash");
        }, CHANGE_FLASH_MS);
        timers.current.add(end);
      }, CHANGE_FLASH_DELAY_MS);
      timers.current.add(start);
    }
  }, [flashIds, parentOf, expandedIds, active, containerRef]);
}
