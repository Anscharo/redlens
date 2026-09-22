// Wheel/trackpad zoom and drag-to-pan bound to one <svg>. The geometry
// lives in svgZoomMath.ts and is re-exported here, so a caller (or a test)
// has one module to reach for.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { clientToView, fillBase, panBy, rebase, viewScale, wheelFactor, zoomAt, type ViewBox } from "./svgZoomMath";

export * from "./svgZoomMath";

/** Movement (client px) before a press counts as a pan rather than a click,
 *  so a drag never steals a link inside the drawing. */
const DRAG_SLOP = 4;

/** The rendered size of `el`, kept current with a ResizeObserver. Zeros
 *  where there is no observer or no layout (jsdom), which fillBase reads as
 *  "use the bare canvas". */
function useElementBox(ref: { current: SVGSVGElement | null }) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      setBox((b) => (b.w === r.width && b.h === r.height ? b : { w: r.width, h: r.height }));
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return box;
}

export function useSvgZoom(width: number, height: number) {
  const ref = useRef<SVGSVGElement | null>(null);
  const box = useElementBox(ref);
  const base = useMemo(() => fillBase(width, height, box.w, box.h), [width, height, box.w, box.h]);
  const [view, setView] = useState<ViewBox>(base);
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const prev = useRef({ width, height, base });

  const reset = useCallback(() => setView(base), [base]);
  // A NEW CANVAS starts over — the caller redrew at a different size (the
  // orbit crops to each month's content) and the old box may not even be
  // inside the new drawing. A resized ELEMENT keeps the zoom, re-mapped onto
  // the new base, so dragging the window does not throw the reader's place
  // away. A canvas that does not change between months keeps its zoom
  // because `base` does not change at all.
  useEffect(() => {
    const was = prev.current;
    prev.current = { width, height, base };
    setView((v) => (was.width === width && was.height === height ? rebase(v, was.base, base) : base));
  }, [base, width, height]);

  // Non-passive, so the page does not scroll under the pointer. React's own
  // onWheel cannot preventDefault reliably, hence the manual listener.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      setView((v) => {
        const a = clientToView(v, rect, e.clientX, e.clientY);
        return zoomAt(v, base, a.x, a.y, wheelFactor(e.deltaY, e.deltaMode, e.ctrlKey));
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [base]);

  const zoomed = view.w < base.w - 0.5 || view.h < base.h - 0.5;

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!zoomed || e.button !== 0) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
  };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    const el = ref.current;
    if (!d || !el || d.id !== e.pointerId) return;
    const cdx = e.clientX - d.x;
    const cdy = e.clientY - d.y;
    if (!d.moved && Math.abs(cdx) + Math.abs(cdy) < DRAG_SLOP) return;
    if (!d.moved) {
      d.moved = true;
      el.setPointerCapture?.(e.pointerId);
    }
    d.x = e.clientX;
    d.y = e.clientY;
    const s = viewScale(view, el.getBoundingClientRect());
    setView((v) => panBy(v, base, cdx / s, cdy / s));
  };
  const endDrag = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (d?.moved) ref.current?.releasePointerCapture?.(e.pointerId);
    drag.current = null;
  };

  return {
    ref,
    /** The box itself, for a caller that has to draw it — the clip rect that
     *  keeps a zoomed drawing inside its frame is the same rectangle. */
    view,
    /** The base the zoom is measured against: the canvas filled out to the
     *  element's aspect. A caller that needs "the whole drawing" wants this,
     *  not (0, 0, width, height). */
    base,
    viewBox: `${view.x} ${view.y} ${view.w} ${view.h}`,
    zoomed,
    reset,
    pan: { onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag },
  };
}

/** Report a chart's zoom state upward, so the way back out can live in the
 *  page's chrome rather than floating over the drawing. The chart owns the
 *  zoom — only the control moved — and unmounting (switching chart styles)
 *  clears the report, so the button never outlives the chart it resets. */
export function useZoomReport(
  zoomed: boolean,
  reset: () => void,
  report?: (state: { zoomed: boolean; reset: () => void } | null) => void,
) {
  useEffect(() => {
    report?.({ zoomed, reset });
    return () => report?.(null);
  }, [zoomed, reset, report]);
}
