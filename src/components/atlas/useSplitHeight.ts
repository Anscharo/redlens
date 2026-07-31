import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useResizeDrag } from "../../hooks/useResizeDrag";

export const SPLIT_MIN_PX = 120;
/** Left for the main reader above the pane, so a drag can't squeeze it to zero. */
export const READER_MIN_PX = 160;
export const SPLIT_DEFAULT_FRACTION = 0.45;
const STORAGE_KEY = "redline-sky-atlas:split-pane-height";

function readStored(): number | null {
  try {
    const n = parseInt(localStorage.getItem(STORAGE_KEY) ?? "", 10);
    return Number.isFinite(n) && n >= SPLIT_MIN_PX ? n : null;
  } catch {
    return null;
  }
}

/**
 * Height + drag-to-resize for the comparison pane, mirroring the tree sidebar's
 * horizontal handle on the vertical axis.
 *
 * The pane is bottom-anchored in the reader column, so the handle sits on its
 * TOP edge and dragging up grows it (growsLeft on the y axis).
 *
 * `contentPx` is a display cap, never a stored value: a doc with no children is
 * short, and the pane shrinks to fit it rather than reserving 45% of the column
 * for a few lines. Writing that shrunken number to storage would silently
 * destroy a height the user had dragged, the first time they opened a leaf — so
 * only the drag's mouseup persists anything.
 */
export function useSplitHeight(shrinkToContent: boolean) {
  const paneRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // null until the column has been measured — the pane renders at the default
  // fraction in the meantime, so first paint isn't a jump.
  const [availPx, setAvailPx] = useState<number | null>(null);
  const [dragged, setDragged] = useState<number | null>(readStored);
  const [contentPx, setContentPx] = useState<number | null>(null);

  // The reader column only changes height when the window does; a
  // ResizeObserver on it would be machinery for an event we already get.
  useLayoutEffect(() => {
    const measure = () => {
      const parent = paneRef.current?.parentElement;
      if (parent) setAvailPx(parent.clientHeight);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Content height DOES need an observer: NodeContent is code-split (lazy +
  // Suspense), so the FIRST measure on a fresh page load — before the chunk's
  // idle-deferred prefetch (prefetchNodeContent) has resolved — can catch the
  // Suspense fallback's skeleton rather than the real content. Fitting the pane
  // to the skeleton's height, then correcting once the real chunk mounts and
  // the ResizeObserver fires again, is a visible jump on the pane's very first
  // open. Skip measuring while any skeleton is still present under `el` —
  // data-node-content-skeleton (NodeContent.tsx) marks it — so the pane keeps
  // its default/dragged height through the loading gap and fits only once real
  // content has replaced it.
  //
  // Observe the CONTENT box, not the scroller: the scroller is flex-1, so its
  // own box never changes when the doc inside it does. What we store is the
  // height the pane would need — content plus the chrome around it (the
  // breadcrumb header and borders), measured as the scroller's offset from the
  // pane's top (pane has position:relative, so this is exactly the header's
  // height) — stable regardless of the pane's own current total height, unlike
  // pane.clientHeight minus scroller.clientHeight.
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el || !shrinkToContent) {
      setContentPx(null);
      return;
    }
    const measure = () => {
      const scroller = scrollerRef.current;
      if (!scroller || el.querySelector("[data-node-content-skeleton]")) return;
      setContentPx(el.scrollHeight + scroller.offsetTop);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [shrinkToContent]);

  const defaultPx = availPx == null ? null : Math.round(availPx * SPLIT_DEFAULT_FRACTION);
  const maxPx =
    availPx == null ? SPLIT_MIN_PX : Math.max(SPLIT_MIN_PX, availPx - READER_MIN_PX);
  const base = Math.min(dragged ?? defaultPx ?? 0, maxPx);
  const fitted = contentPx == null ? base : Math.min(base, contentPx);
  const height = availPx == null && dragged == null ? null : Math.max(SPLIT_MIN_PX, fitted);

  const setHeight = useCallback((h: number) => setDragged(h), []);
  const startResize = useResizeDrag(height ?? SPLIT_MIN_PX, setHeight, {
    min: SPLIT_MIN_PX,
    max: maxPx,
    axis: "y",
    growsLeft: true, // on y: drag up to grow (the pane is bottom-anchored)
    storageKey: STORAGE_KEY,
  });

  // A stored height taller than the current window would pin the pane over the
  // reader; clamp once the column is measured rather than at read time, since
  // the window size isn't known when the initial state runs.
  useEffect(() => {
    if (availPx != null && dragged != null && dragged > maxPx) setDragged(maxPx);
  }, [availPx, dragged, maxPx]);

  return { paneRef, scrollerRef, contentRef, height, startResize };
}
