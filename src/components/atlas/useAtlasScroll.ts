import { useRef, useEffect } from "react";
import { type LoadedData } from "../../lib/atlasHelpers";
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
  useEffect(() => {
    scrolledRef.current = null;
  }, [id, viewKey]);

  useEffect(() => {
    if (!id || !data) return;
    requestAnimationFrame(() => {
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
