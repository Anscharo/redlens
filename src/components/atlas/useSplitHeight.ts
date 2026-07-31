import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useResizeDrag } from "../../hooks/useResizeDrag";

export const SPLIT_MIN_PX = 120;
/** The undragged pane never defaults taller than this fraction of the column,
 *  even for a doc whose own content would want more room. */
export const SPLIT_DEFAULT_MAX_FRACTION = 0.5;
/** Dragging can grow the pane up to this fraction of the column, always
 *  leaving the reader at least 40%. */
export const SPLIT_MAX_FRACTION = 0.6;
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
 * Undragged, the pane defaults to the doc's own rendered size — content plus
 * chrome (`contentPx`) — capped at SPLIT_DEFAULT_MAX_FRACTION of the column: a
 * short leaf gets exactly the room it needs, a doc with many children doesn't
 * take over the column just because its full list is tall. `contentPx` is a
 * display cap, never a stored value: writing a content-driven number to
 * storage would silently destroy a height the user had dragged, the first
 * time they opened a short doc — only the drag's mouseup persists anything.
 * A drag can still go further than the default cap, up to SPLIT_MAX_FRACTION.
 */
export function useSplitHeight() {
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
    if (!el) return;
    const measure = () => {
      const scroller = scrollerRef.current;
      if (!scroller || el.querySelector("[data-node-content-skeleton]")) return;
      setContentPx(el.scrollHeight + scroller.offsetTop);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  const defaultCapPx = availPx == null ? null : Math.round(availPx * SPLIT_DEFAULT_MAX_FRACTION);
  const maxPx =
    availPx == null ? SPLIT_MIN_PX : Math.max(SPLIT_MIN_PX, Math.round(availPx * SPLIT_MAX_FRACTION));
  // Undragged preference: the doc's own size, never past the default cap.
  const preferredPx =
    contentPx == null ? defaultCapPx : defaultCapPx == null ? contentPx : Math.min(contentPx, defaultCapPx);
  const base = Math.min(dragged ?? preferredPx ?? 0, maxPx);
  const height = availPx == null && dragged == null ? null : Math.max(SPLIT_MIN_PX, base);

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
