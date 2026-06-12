import { useRef, useEffect } from "react";
import { type LoadedData } from "../../lib/atlasHelpers";

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
      const { top, bottom } = el.getBoundingClientRect();
      if (bottom <= 64 || top >= window.innerHeight)
        el.scrollIntoView({ behavior: "instant", block: "start" });
      scrolledRef.current = id;
    });
  }, [id, data, expandedParents]);
}
