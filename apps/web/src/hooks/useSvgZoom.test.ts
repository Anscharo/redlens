import { describe, it, expect } from "vitest";
import { clampView, clientToView, fillBase, KEY_PAN_FRACTION, KEY_ZOOM_STEP, MAX_SCALE, panBy, rebase, viewScale, wheelFactor, zoomAt, zoomKeyAction, type ViewBox } from "./useSvgZoom";

const W = 3000;
const H = 1200;
/** No element size yet (jsdom, or before layout): the base is the canvas. */
const full: ViewBox = { x: 0, y: 0, w: W, h: H };
/** The rendered box: wider in proportion than the canvas, so `meet` would
 *  pillarbox it and the base has to grow sideways to fill. */
const rect = { left: 100, top: 50, width: 1000, height: 300 };
const wide = fillBase(W, H, rect.width, rect.height);

describe("fillBase", () => {
  it("widens the canvas to a wider element, keeping the drawing's scale and centre", () => {
    expect(wide.w / wide.h).toBeCloseTo(rect.width / rect.height, 9);
    expect(wide.h).toBe(H);
    expect(wide.w).toBeGreaterThan(W);
    // Centred on the drawing, so nothing moves — the letterbox just becomes
    // canvas, half of it each side.
    expect(wide.x + wide.w / 2).toBeCloseTo(W / 2, 9);
    expect(wide.x).toBeLessThan(0);
    // And the rendered scale is what `meet` gave before: height-bound.
    expect(viewScale(wide, rect)).toBeCloseTo(rect.height / H, 9);
    expect(viewScale(wide, rect)).toBeCloseTo(Math.min(rect.width / W, rect.height / H), 9);
  });

  it("heightens the canvas to a taller element", () => {
    const tall = fillBase(W, H, 300, 1000);
    expect(tall.w).toBe(W);
    expect(tall.h).toBeGreaterThan(H);
    expect(tall.y + tall.h / 2).toBeCloseTo(H / 2, 9);
  });

  it("leaves the canvas alone when the aspects already match, or the element has no size", () => {
    expect(fillBase(W, H, 1500, 600)).toEqual(full);
    expect(fillBase(W, H, 0, 0)).toEqual(full);
    expect(fillBase(W, H, 1000, 0)).toEqual(full);
    expect(fillBase(W, H, Number.NaN, 300)).toEqual(full);
    expect(fillBase(0, 0, 1000, 300)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});

describe("zoomAt", () => {
  it("keeps the anchor point under the pointer", () => {
    const a = { x: 2100, y: 900 };
    let v = full;
    for (const f of [1.3, 1.3, 2, 1.1]) {
      const before = { x: (a.x - v.x) / v.w, y: (a.y - v.y) / v.h };
      v = zoomAt(v, full, a.x, a.y, f);
      expect((a.x - v.x) / v.w).toBeCloseTo(before.x, 6);
      expect((a.y - v.y) / v.h).toBeCloseTo(before.y, 6);
    }
    expect(v.w).toBeLessThan(W);
  });

  it("keeps the base's aspect ratio, so the rendered scale stays uniform", () => {
    expect(zoomAt(full, full, 1000, 400, 3).w / zoomAt(full, full, 1000, 400, 3).h).toBeCloseTo(W / H, 6);
    const z = zoomAt(wide, wide, 1000, 400, 3);
    expect(z.w / z.h).toBeCloseTo(wide.w / wide.h, 6);
  });

  it("clamps to the whole base out and MAX_SCALE in", () => {
    expect(zoomAt(full, full, 0, 0, 0.1)).toEqual(full);
    let v = full;
    for (let i = 0; i < 40; i++) v = zoomAt(v, full, 1500, 600, 1.5);
    expect(v.w).toBeCloseTo(W / MAX_SCALE, 6);
    for (let i = 0; i < 40; i++) v = zoomAt(v, full, 2900, 1100, 1 / 1.5);
    expect(v).toEqual(full);
    // On a widened base the limits are the BASE's, not the canvas'.
    let z = wide;
    for (let i = 0; i < 40; i++) z = zoomAt(z, wide, 1500, 600, 1.5);
    expect(z.w).toBeCloseTo(wide.w / MAX_SCALE, 6);
    for (let i = 0; i < 40; i++) z = zoomAt(z, wide, 0, 0, 1 / 1.5);
    expect(z.x).toBeCloseTo(wide.x, 6);
    expect(z.w).toBeCloseTo(wide.w, 6);
  });

  it("never lets the box leave the base, whatever the anchor", () => {
    for (const a of [{ x: 0, y: 0 }, { x: W, y: H }, { x: -5000, y: 2000 }]) {
      for (const base of [full, wide]) {
        const v = zoomAt(base, base, a.x, a.y, 4);
        expect(v.x).toBeGreaterThanOrEqual(base.x - 1e-9);
        expect(v.y).toBeGreaterThanOrEqual(base.y - 1e-9);
        expect(v.x + v.w).toBeLessThanOrEqual(base.x + base.w + 1e-9);
        expect(v.y + v.h).toBeLessThanOrEqual(base.y + base.h + 1e-9);
      }
    }
  });
});

describe("clampView and panBy", () => {
  it("pulls a box back inside the base and caps it at the base's size", () => {
    expect(clampView({ x: -50, y: -50, w: W * 2, h: H * 2 }, full)).toEqual(full);
    expect(clampView({ x: 9999, y: 9999, w: 300, h: 120 }, full)).toEqual({ x: W - 300, y: H - 120, w: 300, h: 120 });
    // A widened base reaches left of zero, and the clamp follows it there.
    expect(clampView({ x: -9999, y: 0, w: 300, h: 120 }, wide).x).toBeCloseTo(wide.x, 9);
  });

  it("moves the box against the drag, and stops at the base's edges", () => {
    const v: ViewBox = { x: 300, y: 120, w: 300, h: 120 };
    expect(panBy(v, full, 100, 20)).toEqual({ ...v, x: 200, y: 100 });
    expect(panBy(v, full, 5000, 5000)).toEqual({ ...v, x: 0, y: 0 });
    expect(panBy(v, full, -5000, -5000)).toEqual({ ...v, x: W - 300, y: H - 120 });
    expect(panBy(v, wide, 5000, 5000).x).toBeCloseTo(wide.x, 9);
    // A box that fills the frame cannot pan at all.
    expect(panBy(full, full, 200, 200)).toEqual(full);
  });
});

describe("rebase", () => {
  it("carries the zoom onto a resized base: same fraction shown, same centre", () => {
    const v = zoomAt(full, full, 2100, 900, 4);
    const r = rebase(v, full, wide);
    expect(r.w / wide.w).toBeCloseTo(v.w / full.w, 6);
    expect((r.x + r.w / 2 - wide.x) / wide.w).toBeCloseTo((v.x + v.w / 2 - full.x) / full.w, 6);
    expect(r.w / r.h).toBeCloseTo(wide.w / wide.h, 6);
  });

  it("is the identity at rest, and never returns a box outside the new base", () => {
    expect(rebase(full, full, full)).toEqual(full);
    expect(rebase(wide, wide, wide)).toEqual(wide);
    expect(rebase(full, full, wide)).toEqual(wide);
    const r = rebase({ x: -9999, y: 0, w: W * 9, h: H * 9 }, full, wide);
    expect(r).toEqual(wide);
    // A base with no size yet just hands back the new one.
    expect(rebase(full, { x: 0, y: 0, w: 0, h: 0 }, wide)).toEqual(wide);
  });
});

describe("clientToView", () => {
  it("allows for the letterboxing a canvas-shaped viewBox still leaves", () => {
    expect(viewScale(full, rect)).toBeCloseTo(rect.height / H, 6);
    // The rendered drawing is 750 wide inside a 1000-wide box, so 125px of
    // slack each side: the box's own centre is the drawing's centre.
    const mid = clientToView(full, rect, rect.left + rect.width / 2, rect.top + rect.height / 2);
    expect(mid.x).toBeCloseTo(W / 2, 6);
    expect(mid.y).toBeCloseTo(H / 2, 6);
    const left = clientToView(full, rect, rect.left + 125, rect.top);
    expect(left.x).toBeCloseTo(0, 6);
    expect(left.y).toBeCloseTo(0, 6);
  });

  it("maps the element's own edges once the base fills it", () => {
    const tl = clientToView(wide, rect, rect.left, rect.top);
    expect(tl.x).toBeCloseTo(wide.x, 6);
    expect(tl.y).toBeCloseTo(wide.y, 6);
    const br = clientToView(wide, rect, rect.left + rect.width, rect.top + rect.height);
    expect(br.x).toBeCloseTo(wide.x + wide.w, 6);
    expect(br.y).toBeCloseTo(wide.y + wide.h, 6);
  });

  it("reads a zoomed box's own coordinates", () => {
    const v: ViewBox = { x: 1500, y: 600, w: 750, h: 300 };
    const p = clientToView(v, rect, rect.left + rect.width / 2, rect.top + rect.height / 2);
    expect(p.x).toBeCloseTo(v.x + v.w / 2, 6);
    expect(p.y).toBeCloseTo(v.y + v.h / 2, 6);
  });
});

describe("wheelFactor", () => {
  it("zooms in on a scroll up and out on a scroll down, symmetrically", () => {
    expect(wheelFactor(-100, 0, false)).toBeGreaterThan(1);
    expect(wheelFactor(100, 0, false)).toBeLessThan(1);
    expect(wheelFactor(-100, 0, false) * wheelFactor(100, 0, false)).toBeCloseTo(1, 6);
    expect(wheelFactor(0, 0, false)).toBe(1);
  });

  it("gives a trackpad pinch (ctrlKey, small deltas) a steeper response, and normalises line/page deltas", () => {
    expect(wheelFactor(-10, 0, true)).toBeGreaterThan(wheelFactor(-10, 0, false));
    expect(wheelFactor(-1, 1, false)).toBeCloseTo(wheelFactor(-16, 0, false), 6);
    expect(wheelFactor(-1, 2, false)).toBeCloseTo(wheelFactor(-100, 0, false), 6);
  });
});

describe("zoomKeyAction — the chart's keyboard map", () => {
  const base: ViewBox = { x: 0, y: 0, w: 1000, h: 500 };

  it("maps + and - to a zoom either way, and nothing else to a zoom", () => {
    expect(zoomKeyAction("+")).toEqual({ kind: "zoom", factor: KEY_ZOOM_STEP });
    expect(zoomKeyAction("=")).toEqual({ kind: "zoom", factor: KEY_ZOOM_STEP });
    expect(zoomKeyAction("-")).toEqual({ kind: "zoom", factor: 1 / KEY_ZOOM_STEP });
    expect(zoomKeyAction("_")).toEqual({ kind: "zoom", factor: 1 / KEY_ZOOM_STEP });
  });

  it("maps the arrows to a pan that moves the drawing the way the key points", () => {
    // ArrowRight looks further right, so the BOX moves right — which is a
    // negative drag of the drawing, the same sign a leftward drag has.
    expect(zoomKeyAction("ArrowRight")).toEqual({ kind: "pan", dx: -KEY_PAN_FRACTION, dy: 0 });
    expect(zoomKeyAction("ArrowLeft")).toEqual({ kind: "pan", dx: KEY_PAN_FRACTION, dy: 0 });
    expect(zoomKeyAction("ArrowDown")).toEqual({ kind: "pan", dx: 0, dy: -KEY_PAN_FRACTION });
    expect(zoomKeyAction("ArrowUp")).toEqual({ kind: "pan", dx: 0, dy: KEY_PAN_FRACTION });
  });

  it("maps 0 and Escape to a reset, and claims no other key", () => {
    expect(zoomKeyAction("0")).toEqual({ kind: "reset" });
    expect(zoomKeyAction("Escape")).toEqual({ kind: "reset" });
    for (const k of ["a", "Enter", "Tab", " ", "PageDown", "Home"]) {
      expect(zoomKeyAction(k)).toBeNull();
    }
  });

  it("zooms about the centre, so a keyboard user keeps what they were looking at", () => {
    const action = zoomKeyAction("+")!;
    if (action.kind !== "zoom") throw new Error("expected a zoom");
    const v = zoomAt(base, base, base.w / 2, base.h / 2, action.factor);
    expect(v.w).toBeCloseTo(base.w / KEY_ZOOM_STEP, 6);
    // The centre point is still the centre.
    expect(v.x + v.w / 2).toBeCloseTo(base.x + base.w / 2, 6);
    expect(v.y + v.h / 2).toBeCloseTo(base.y + base.h / 2, 6);
  });

  it("cannot pan or zoom out past the whole drawing", () => {
    const zoomedIn = zoomAt(base, base, 0, 0, 4);
    const panned = panBy(zoomedIn, base, KEY_PAN_FRACTION * zoomedIn.w * 50, 0);
    expect(panned.x).toBeGreaterThanOrEqual(base.x - 1e-6);
    const out = zoomAt(base, base, base.w / 2, base.h / 2, 1 / KEY_ZOOM_STEP);
    expect(out.w).toBeLessThanOrEqual(base.w + 1e-6);
  });
});
