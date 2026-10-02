// Subscribe to a CSS media query as React state.
//
// A media query is external, browser-owned state, so it is read through
// useSyncExternalStore rather than mirrored into useState by an effect: that
// way the first render already has the right answer and there is no frame where
// a layout flips. The server snapshot is `false`, so anything gated on this
// renders its narrow form until the browser says otherwise.
import { useCallback, useSyncExternalStore } from "react";

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    [query],
  );
  const get = useCallback(
    () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false),
    [query],
  );
  return useSyncExternalStore(subscribe, get, () => false);
}
