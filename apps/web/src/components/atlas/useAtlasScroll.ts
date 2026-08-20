import { useRef, useEffect } from "react";
import { type LoadedData } from "@/lib/atlasHelpers";
import { scrollRequestStore } from "../../lib/scrollRequestStore";
import { scrollIfOutOfView } from "../../lib/animatedScroll";
import type { Rung } from "./subtreeState";

export function useAtlasScroll(
  id: string,
  data: LoadedData | null,
  // Only identity matters here — a re-scroll is triggered whenever this Map
  // gets a new reference (a rung actually changed), never by reading its
  // contents.
  rung: ReadonlyMap<string, Rung>,
  // Changes when the reader switches view mode (all ⇄ selected-only ⇄ changed).
  // Switching rebuilds the list and moves the selected row, so we must re-scroll
  // to it even though `id` didn't change — otherwise it drops out of view.
  viewKey?: string,
) {
  // scrolledRef guards against re-scrolling when only `rung` changes (per-level
  // disclosure). Reset on every id or view-mode change so we re-check and
  // scroll if needed.
  const scrolledRef = useRef<string | null>(null);
  // userMovedRef guards against re-scrolling when `data` swaps identity (the
  // shallow→full bundle swap a few seconds after load — see useAtlasData) or
  // `rung` gets a new Map after the user has already scrolled elsewhere by
  // hand. Reset alongside scrolledRef so a fresh id/view still gets its
  // deep-link glide even if the user had moved around the previous selection.
  const userMovedRef = useRef(false);
  useEffect(() => {
    scrolledRef.current = null;
    userMovedRef.current = false;
  }, [id, viewKey]);

  // wheel/touchmove (not scroll) are the signal: `scroll` also fires for our
  // own programmatic scrollIfOutOfView calls, which would immediately trip
  // this guard and defeat the auto-glide on the very scroll it's meant to
  // allow. wheel/touchmove only fire for real user input. Keyboard paging and
  // scrollbar-drag scrolling aren't covered by either — an accepted gap, not
  // one to close by adding a `scroll` listener.
  useEffect(() => {
    const onUserMove = () => {
      userMovedRef.current = true;
    };
    window.addEventListener("wheel", onUserMove, { passive: true });
    window.addEventListener("touchmove", onUserMove, { passive: true });
    return () => {
      window.removeEventListener("wheel", onUserMove);
      window.removeEventListener("touchmove", onUserMove);
    };
  }, []);

  useEffect(() => {
    if (!id || !data) return;
    requestAnimationFrame(() => {
      // Deliberately doesn't touch scrolledRef here: userMovedRef only
      // clears on the next id/viewKey change, which also clears scrolledRef,
      // so leaving it unlatched costs nothing and avoids a stale latch
      // outliving the guard it'd be redundant with.
      if (userMovedRef.current) return;
      const el = document.getElementById(id);
      if (!el || scrolledRef.current === id) return;
      scrollIfOutOfView(el);
      scrolledRef.current = id;
    });
  }, [id, data, rung, viewKey]);

  // Sidebar clicks always request a scroll, even when the clicked row is
  // already the selection (the id-change effect above won't re-fire then).
  useEffect(() => {
    return scrollRequestStore.subscribe((targetId) => {
      requestAnimationFrame(() => {
        const el = document.getElementById(targetId);
        if (el) scrollIfOutOfView(el);
      });
    });
  }, []);
}
