// The pure geometry behind useSvgZoom (which re-exports all of it): the
// base view, the anchor-preserving zoom, the pan and the clamp for charts
// whose thinnest marks are too small to hit at 1× — the flow chart's
// hairline ribbons, the orbit's thinnest wedges. No React and no DOM here,
// so every one of these is testable without events.
//
// THE BASE VIEW IS NOT THE CANVAS. A drawing's canvas rarely has the same
// aspect ratio as the box the card gives it, and `xMidYMid meet` answers
// that by letterboxing — which leaves a dead margin down each side and,
// once zoomed, a drawing that stops short of its own frame. So the base
// view is the canvas WIDENED (or heightened) to the element's aspect and
// re-centred on the drawing: the rendered scale and centre are exactly what
// `meet` produced, the letterbox simply becomes usable canvas, and every
// clamp is taken from that base rather than from 0..width/0..height.
export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How far in a chart can go. Past this the hairlines are pointer-sized
 *  many times over and the labels have left the frame. */
export const MAX_SCALE = 8;

/** The canvas grown to the rendered element's aspect ratio, centred on the
 *  drawing, so `meet` has nothing left to letterbox. Falls back to the bare
 *  canvas whenever the element has no size yet — before layout, and in
 *  jsdom, where getBoundingClientRect is all zeros. */
export function fillBase(width: number, height: number, elW: number, elH: number): ViewBox {
  const canvas = { x: 0, y: 0, w: width, h: height };
  if (!(elW > 0) || !(elH > 0) || !(width > 0) || !(height > 0)) return canvas;
  const want = elW / elH;
  if (Math.abs(want - width / height) < 1e-9) return canvas;
  if (want > width / height) {
    const w = height * want;
    return { x: (width - w) / 2, y: 0, w, h: height };
  }
  const h = width / want;
  return { x: 0, y: (height - h) / 2, w: width, h };
}

/** Keep the box inside the base, and never larger than it. */
export function clampView(v: ViewBox, base: ViewBox): ViewBox {
  const w = Math.min(v.w, base.w);
  const h = Math.min(v.h, base.h);
  return {
    w,
    h,
    x: Math.min(Math.max(v.x, base.x), base.x + base.w - w),
    y: Math.min(Math.max(v.y, base.y), base.y + base.h - h),
  };
}

/** Zoom by `factor` about (ax, ay) in drawing coordinates: that point keeps
 *  its place in the frame, so whatever is under the pointer stays there. */
export function zoomAt(v: ViewBox, base: ViewBox, ax: number, ay: number, factor: number): ViewBox {
  const w = Math.min(base.w, Math.max(base.w / MAX_SCALE, v.w / factor));
  const k = w / v.w;
  // Height follows the width rather than scaling alongside it, so a long run
  // of zooms can never drift off the base's aspect ratio.
  return clampView({ x: ax - (ax - v.x) * k, y: ay - (ay - v.y) * k, w, h: (w * base.h) / base.w }, base);
}

/** Drag the drawing by (dx, dy) drawing units — the box moves the other way. */
export function panBy(v: ViewBox, base: ViewBox, dx: number, dy: number): ViewBox {
  return clampView({ ...v, x: v.x - dx, y: v.y - dy }, base);
}

/** The same view carried from one base onto another — what a resized element
 *  needs: the fraction of the base on show and the point it is centred on
 *  are kept, so a resize never throws away the zoom. */
export function rebase(v: ViewBox, from: ViewBox, to: ViewBox): ViewBox {
  if (!(from.w > 0) || !(from.h > 0)) return to;
  const k = Math.min(1, v.w / from.w);
  const cx = (v.x + v.w / 2 - from.x) / from.w;
  const cy = (v.y + v.h / 2 - from.y) / from.h;
  const w = to.w * k;
  const h = to.h * k;
  return clampView({ x: to.x + cx * to.w - w / 2, y: to.y + cy * to.h - h / 2, w, h }, to);
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

/** A client point in drawing coordinates, allowing for any letterboxing
 *  still left on whichever axis is not binding. */
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


/** One press of the keyboard map, as an action the caller applies to its
 *  view — so the map itself is testable without a DOM. Zoom steps by this
 *  much per press, panning by this fraction of the box. */
export const KEY_ZOOM_STEP = 1.3;
export const KEY_PAN_FRACTION = 1 / 8;

export type ZoomKeyAction =
  | { kind: "zoom"; factor: number }
  | { kind: "pan"; dx: number; dy: number }
  | { kind: "reset" };

/** The chart's keyboard map, mirroring what the pointer can do: + / - zoom
 *  about the centre, the arrows pan, 0 and Escape go back to the whole
 *  drawing. Returns null for a key the chart does not claim, so the caller
 *  leaves it to the page (and only preventDefaults what it handled). */
export function zoomKeyAction(key: string): ZoomKeyAction | null {
  switch (key) {
    case "+":
    case "=":
      return { kind: "zoom", factor: KEY_ZOOM_STEP };
    case "-":
    case "_":
      return { kind: "zoom", factor: 1 / KEY_ZOOM_STEP };
    case "ArrowLeft":
      return { kind: "pan", dx: KEY_PAN_FRACTION, dy: 0 };
    case "ArrowRight":
      return { kind: "pan", dx: -KEY_PAN_FRACTION, dy: 0 };
    case "ArrowUp":
      return { kind: "pan", dy: KEY_PAN_FRACTION, dx: 0 };
    case "ArrowDown":
      return { kind: "pan", dy: -KEY_PAN_FRACTION, dx: 0 };
    case "0":
    case "Escape":
      return { kind: "reset" };
    default:
      return null;
  }
}
