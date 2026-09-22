// Wheel/trackpad zoom and drag-to-pan over an SVG's viewBox, for charts
// whose thinnest marks are too small to hit at 1× (the MSC flow chart's
// hairline ribbons). The maths is pure and exported on its own so the
// anchor-preserving zoom and the clamping can be tested without events.
//
// The viewBox always keeps the drawing's aspect ratio, so with
// preserveAspectRatio="xMidYMid meet" the rendered scale is the same in
// both axes and the letterboxing is a fixed offset — which is all
// clientToView needs to turn a pointer position into drawing coordinates.
import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How far in the chart can go. Past this the hairlines are pointer-sized
 *  many times over and the labels have left the frame. */
export const MAX_SCALE = 8;
/** Movement (client px) before a press counts as a pan rather than a click,
 *  so a drag never steals a Prime's link. */
const DRAG_SLOP = 4;

/** Keep the box inside the drawing, and never larger than it. */
export function clampView(v: ViewBox, width: number, height: number): ViewBox {
  const w = Math.min(v.w, width);
  const h = Math.min(v.h, height);
  return {
    w,
    h,
    x: Math.min(Math.max(v.x, 0), width - w),
    y: Math.min(Math.max(v.y, 0), height - h),
  };
}

/** Zoom by `factor` about (ax, ay) in drawing coordinates: that point keeps
 *  its place in the frame, so whatever is under the pointer stays there. */
export function zoomAt(v: ViewBox, width: number, height: number, ax: number, ay: number, factor: number): ViewBox {
  const w = Math.min(width, Math.max(width / MAX_SCALE, v.w / factor));
  const k = w / v.w;
  // Height is derived from the width rather than scaled alongside it, so a
  // long run of zooms can never drift off the drawing's aspect ratio.
  return clampView({ x: ax - (ax - v.x) * k, y: ay - (ay - v.y) * k, w, h: (w * height) / width }, width, height);
}

/** Drag the drawing by (dx, dy) drawing units — the box moves the other way. */
export function panBy(v: ViewBox, width: number, height: number, dx: number, dy: number): ViewBox {
  return clampView({ ...v, x: v.x - dx, y: v.y - dy }, width, height);
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Rendered px per drawing unit under `meet` — the same in both axes. */
export function viewScale(v: ViewBox, rect: Rect): number {
  return Math.min(rect.width / v.w, rect.height / v.h) || 1;
}

/** A client point in drawing coordinates, allowing for the letterboxing
 *  `xMidYMid meet` leaves on whichever axis is not binding. */
export function clientToView(v: ViewBox, rect: Rect, clientX: number, clientY: number): { x: number; y: number } {
  const s = viewScale(v, rect);
  return {
    x: v.x + (clientX - rect.left - (rect.width - v.w * s) / 2) / s,
    y: v.y + (clientY - rect.top - (rect.height - v.h * s) / 2) / s,
  };
}

/** One wheel event's zoom factor. A trackpad pinch arrives as a wheel with
 *  ctrlKey and much smaller deltas, so it gets the steeper response; line-
 *  and page-mode deltas are normalised to pixels first. */
export function wheelFactor(deltaY: number, deltaMode: number, ctrlKey: boolean): number {
  const px = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 100 : 1);
  return Math.exp((-px * (ctrlKey ? 4 : 1)) / 400);
}

export function useSvgZoom(width: number, height: number) {
  const ref = useRef<SVGSVGElement | null>(null);
  const [view, setView] = useState<ViewBox>(() => ({ x: 0, y: 0, w: width, h: height }));
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);

  const reset = useCallback(() => setView({ x: 0, y: 0, w: width, h: height }), [width, height]);
  // A month change keeps the zoom (the canvas is the same size every month);
  // a canvas that really resized starts over, since the old box may not fit.
  useEffect(() => setView({ x: 0, y: 0, w: width, h: height }), [width, height]);

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
        return zoomAt(v, width, height, a.x, a.y, wheelFactor(e.deltaY, e.deltaMode, e.ctrlKey));
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [width, height]);

  const zoomed = view.w < width - 0.5 || view.h < height - 0.5;

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
    setView((v) => panBy(v, width, height, cdx / s, cdy / s));
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
    viewBox: `${view.x} ${view.y} ${view.w} ${view.h}`,
    zoomed,
    reset,
    pan: { onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag },
  };
}
