import { useRef, useEffect } from "react";
import { type LoadedData } from "../../lib/atlasHelpers";
import { scrollRequestStore } from "../../lib/scrollRequestStore";
import { scrollIfOutOfView } from "../../lib/animatedScroll";

export function useAtlasScroll(
  id: string,
  data: LoadedData | null,
  expandedParents: Set<string>,
) {
  // scrolledRef guards against re-scrolling when only expandedParents changes (depth-6 expand).
  // Reset on every id change so revisiting a node re-checks and scrolls if needed.
  const scrolledRef = useRef<string | null>(null);
  useEffect(() => {
    scrolledRef.current = null;
  }, [id]);

  useEffect(() => {
    if (!id || !data) return;
    requestAnimationFrame(() => {
      const el = document.getElementById(id);
      if (!el || scrolledRef.current === id) return;
      scrollIfOutOfView(el);
      scrolledRef.current = id;
    });
  }, [id, data, expandedParents]);

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
