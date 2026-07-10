import { useEffect, useRef, type RefObject } from "react";
import { useLocation, useSearchParams } from "wouter";
import { saveScroll, getSavedScroll } from "../lib/scrollMemory";

// Restores `ref.scrollTop` for the current URL on mount (after `ready`), and
// saves it on unmount or when the URL changes. No on-scroll listeners.
//
// Pass `ready=true` only once the scroll target actually exists (data loaded,
// list rendered) — otherwise the restore is wasted on an empty container and
// the saved value gets overwritten with 0.
//
// Pass `excludeParams` for URL params that don't represent a distinct scroll
// context (e.g. a "show more" pagination counter) — changing them shouldn't
// change the restore key, or the position resets to the top every time the
// param changes.
//
// If the URL has a #hash, the hook stays out of the way so anchor scroll wins.
export function useScrollRestore(
  ref: RefObject<HTMLElement | null>,
  ready: boolean = true,
  excludeParams: readonly string[] = [],
): void {
  const [path] = useLocation();
  const [params] = useSearchParams();
  const filtered = new URLSearchParams(params);
  for (const p of excludeParams) filtered.delete(p);
  const search = filtered.toString();
  const key = search ? `${path}?${search}` : path;
  const restoredKey = useRef<string | null>(null);

  // Save on unmount or when key changes. Cleanup closure captures the key
  // value at the time the effect ran, so writes go to the OLD key on change.
  useEffect(() => {
    const el = ref.current;
    return () => {
      if (el) saveScroll(key, el.scrollTop);
    };
  }, [key, ref]);

  // Restore once per key, once data is ready.
  useEffect(() => {
    if (!ready) return;
    if (restoredKey.current === key) return;
    const el = ref.current;
    if (!el) return;
    if (typeof window !== "undefined" && window.location.hash) {
      restoredKey.current = key;
      return;
    }
    const saved = getSavedScroll(key);
    el.scrollTop = saved ?? 0;
    restoredKey.current = key;
  }, [key, ready, ref]);
}
