import { describe, it, expect } from "vitest";
import { clampView, clientToView, MAX_SCALE, panBy, viewScale, wheelFactor, zoomAt, type ViewBox } from "./useSvgZoom";

const W = 3000;
const H = 1200;
const full: ViewBox = { x: 0, y: 0, w: W, h: H };
/** The rendered box: wider in proportion than the drawing, so `meet` is
 *  height-bound and the letterboxing is horizontal. */
const rect = { left: 100, top: 50, width: 1000, height: 300 };

describe("zoomAt", () => {
  it("keeps the anchor point under the pointer", () => {
    const a = { x: 2100, y: 900 };
    let v = full;
    for (const f of [1.3, 1.3, 2, 1.1]) {
      const before = { x: (a.x - v.x) / v.w, y: (a.y - v.y) / v.h };
      v = zoomAt(v, W, H, a.x, a.y, f);
      expect((a.x - v.x) / v.w).toBeCloseTo(before.x, 6);
      expect((a.y - v.y) / v.h).toBeCloseTo(before.y, 6);
    }
    expect(v.w).toBeLessThan(W);
  });

  it("keeps the drawing's aspect ratio, so the rendered scale stays uniform", () => {
    const v = zoomAt(full, W, H, 1000, 400, 3);
    expect(v.w / v.h).toBeCloseTo(W / H, 6);
  });

  it("clamps to 1× out and MAX_SCALE in", () => {
    expect(zoomAt(full, W, H, 0, 0, 0.1)).toEqual(full);
    let v = full;
    for (let i = 0; i < 40; i++) v = zoomAt(v, W, H, 1500, 600, 1.5);
    expect(v.w).toBeCloseTo(W / MAX_SCALE, 6);
    // And back out again: zooming out far enough always restores the whole
    // drawing, never a box hanging off an edge.
    for (let i = 0; i < 40; i++) v = zoomAt(v, W, H, 2900, 1100, 1 / 1.5);
    expect(v).toEqual(full);
  });

  it("never lets the box leave the drawing, whatever the anchor", () => {
    for (const a of [{ x: 0, y: 0 }, { x: W, y: H }, { x: -500, y: 2000 }]) {
      const v = zoomAt(full, W, H, a.x, a.y, 4);
      expect(v.x).toBeGreaterThanOrEqual(0);
      expect(v.y).toBeGreaterThanOrEqual(0);
      expect(v.x + v.w).toBeLessThanOrEqual(W + 1e-9);
      expect(v.y + v.h).toBeLessThanOrEqual(H + 1e-9);
    }
  });
});

describe("clampView and panBy", () => {
  it("pulls a box back inside and caps it at the drawing's size", () => {
    expect(clampView({ x: -50, y: -50, w: W * 2, h: H * 2 }, W, H)).toEqual(full);
    expect(clampView({ x: 9999, y: 9999, w: 300, h: 120 }, W, H)).toEqual({ x: W - 300, y: H - 120, w: 300, h: 120 });
  });

  it("moves the box against the drag, and stops at the edges", () => {
    const v: ViewBox = { x: 300, y: 120, w: 300, h: 120 };
    expect(panBy(v, W, H, 100, 20)).toEqual({ ...v, x: 200, y: 100 });
    expect(panBy(v, W, H, 5000, 5000)).toEqual({ ...v, x: 0, y: 0 });
    expect(panBy(v, W, H, -5000, -5000)).toEqual({ ...v, x: W - 300, y: H - 120 });
    // A box that fills the frame cannot pan at all.
    expect(panBy(full, W, H, 200, 200)).toEqual(full);
  });
});

describe("clientToView", () => {
  it("allows for the letterboxing xMidYMid meet leaves", () => {
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
