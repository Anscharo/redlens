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
      const container = el.closest(".atlas-scroll");
      const clip = container?.getBoundingClientRect() ?? { top: 64, bottom: window.innerHeight };
      const clipH = clip.bottom - clip.top;
      const { top, height } = el.getBoundingClientRect();
      const bottom = top + height;

      if (top < clip.top) {
        // Title is hidden above the clip edge — scroll it back into view.
        // Smooth if close (partially visible or within one viewport away), instant if far.
        const dist = clip.top - bottom; // negative when partially visible
        el.scrollIntoView({ behavior: dist < clipH ? "smooth" : "instant", block: "start" });
      } else {
        // Below: scroll only when less than 50px is showing.
        const visiblePx = Math.min(bottom, clip.bottom) - top;
        if (visiblePx < 50) {
          const dist = top - clip.bottom; // negative when partially visible
          el.scrollIntoView({ behavior: dist < clipH ? "smooth" : "instant", block: "start" });
        }
      }
      scrolledRef.current = id;
    });
  }, [id, data, expandedParents]);
}
