import { useEffect, useRef, type RefObject } from "react";
import { useLocation, useSearchParams } from "wouter";
import { saveScroll, getSavedScroll } from "../lib/scrollMemory";

// Restores `ref.scrollTop` for the current URL on mount (after `ready`), and
// saves it on unmount or when the URL changes.
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

  // Last scrollTop observed while `ref.current` was still attached. The save
  // effect below persists this in its CLEANUP, which for a real unmount fires
  // only after React has already detached the element from the document — a
  // detached element has no CSS layout box, so reading its `.scrollTop` at
  // that point returns 0 regardless of where the user actually scrolled to.
  // Tracking the value here instead (updated live on "scroll", and again
  // right after a restore) means the cleanup always has a genuine pre-detach
  // value to persist rather than a bogus post-detach 0 that would otherwise
  // overwrite a real saved position with the top.
  const lastScrollRef = useRef(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => { lastScrollRef.current = el.scrollTop; };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [ref]);

  // Save on unmount or when key changes. Cleanup closure captures the key
  // value at the time the effect ran, so writes go to the OLD key on change.
  //
  // Gated on `restoredKey.current === key`: lastScrollRef is a single ref
  // that outlives a `key` change, so right after the key changes (e.g. the
  // search query changes while the same component stays mounted) it can
  // still hold the PREVIOUS key's offset — nothing has touched it for the
  // new key yet if `ready` is false (new data not in) and no "scroll" event
  // has fired. Without this gate, unmounting in that window would persist
  // the old key's stale offset under the new key. The restore effect below
  // is what advances restoredKey.current to the new key — resetting
  // lastScrollRef.current to the freshly-restored value in the same breath
  // (see its own comment) — so this check only lets a save through once the
  // tracked value is actually known-good for the CURRENT key.
  useEffect(() => {
    return () => {
      if (restoredKey.current === key) saveScroll(key, lastScrollRef.current);
    };
  }, [key]);

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
    // Keep the tracked value in sync with the restore so navigating away
    // immediately after (before any new "scroll" event fires) still persists
    // the restored position instead of the ref's stale initial value.
    lastScrollRef.current = el.scrollTop;
    restoredKey.current = key;
  }, [key, ready, ref]);
}
