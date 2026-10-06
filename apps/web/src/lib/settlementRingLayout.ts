// A Prime's settlement month as two concentric lanes around it, Sky a node
// at 12 o'clock. The outer lane runs CLOCKWISE from Sky's right round to an
// arrowhead into Sky's left: what the Prime owes Sky (cost of funds + Sky
// Direct Exposure, A.2.4.1.2.2.1.1.2). The inner lane leaves Sky's left
// COUNTERCLOCKWISE and turns in to the Prime at 1 o'clock: what Sky owes
// the Prime on the demand side (A.2.4.1.2.2.1.1.1). The two are never
// netted, so each lane is drawn whole.
//
// One width scale for both lanes: the larger lane total fills BAND, and
// every band's width is its amount on that scale. The radii are fixed, so a
// month change only re-widths bands — the ring itself never moves.
import type { StreamModel } from "@/lib/settlementStreams";
import { arcArrowHead, arcPath, inwardHead } from "./ringGeometry";

export const PRIME_R = 64;
export const BAND = 48;
const INNER0 = PRIME_R + 14;
const LANE_GAP = 16;
const OUTER0 = INNER0 + BAND + LANE_GAP;
export const RING_R = OUTER0 + BAND;
const SKY_HALF_W = 11;
const HEAD_LEN = 12;
const HEAD_FLARE = 3;
/** Thinnest band drawn, so a cent-sized figure is still visible. */
const MIN_W = 1.5;
const TOP = -Math.PI / 2;
/** Where the inner lane turns in to the Prime: 1 o'clock. */
const INNER_END = TOP + Math.PI / 6;
/** Outer lane outward: cost of funds, then SDE. Inner lane outward from the
 *  Prime: the cited demand series first, GAR (no Atlas term) last. */
const INNER_ORDER = ["agentRate", "distributionRewards", "chroniclePoints", "gar"];

export const GUTTER = 190;
export const CX = GUTTER + RING_R + HEAD_FLARE + 8;
export const CY = RING_R + 34;
export const WIDTH = CX * 2;
export const HEIGHT = CY + RING_R + 12;

export interface RingBand {
  key: string;
  value: number;
  /** Centreline radius and stroke width. */
  r: number;
  w: number;
  /** Centreline, in the direction the money moves. */
  d: string;
  /** Arrowhead into Sky (outer lane only). */
  head: string | null;
  loss: boolean;
}

export interface RingLayout {
  outer: RingBand[];
  inner: RingBand[];
  /** The inner lane's turn in to the Prime. */
  inward: string | null;
  sky: { x: number; y: number; w: number; h: number };
}

/** Sky's bar is SKY_HALF_W either side of 12 o'clock; a band at radius r
 *  clears it by this angle. */
const clear = (r: number) => (SKY_HALF_W + 5) / r;

function stack(parts: { key: string; value: number }[], r0: number, scale: number) {
  let edge = r0;
  return parts.map((p) => {
    const w = Math.max(MIN_W, Math.abs(p.value) * scale);
    const r = edge + w / 2;
    edge += w;
    return { key: p.key, value: p.value, r, w, loss: p.value < 0 };
  });
}

export function layoutSettlementRing(m: StreamModel): RingLayout {
  const outerParts = [{ key: "cof", value: m.cof }, { key: "sde", value: m.sde }].filter((p) => Math.abs(p.value) >= 0.5);
  const innerParts = [...m.demand].sort((a, b) => INNER_ORDER.indexOf(a.key) - INNER_ORDER.indexOf(b.key));
  const lane = (ps: { value: number }[]) => ps.reduce((n, p) => n + Math.abs(p.value), 0);
  const max = Math.max(lane(outerParts), lane(innerParts));
  const scale = max > 0 ? BAND / max : 0;

  const outer = stack(outerParts, OUTER0, scale).map((b) => {
    const a0 = TOP + clear(b.r);
    const tip = TOP + 2 * Math.PI - clear(b.r);
    const a1 = tip - HEAD_LEN / b.r;
    return { ...b, d: arcPath(CX, CY, b.r, a0, a1), head: arcArrowHead(CX, CY, b.r, b.w, a1, 1, HEAD_LEN, HEAD_FLARE) };
  });
  const inner = stack(innerParts, INNER0, scale).map((b) => ({
    ...b,
    d: arcPath(CX, CY, b.r, TOP + 2 * Math.PI - clear(b.r), INNER_END),
    head: null,
  }));
  return {
    outer,
    inner,
    inward: inner.length ? inwardHead(CX, CY, INNER0 + 1, PRIME_R + 2, INNER_END + 0.09, 0.09) : null,
    sky: { x: CX - SKY_HALF_W, y: CY - RING_R - 6, w: SKY_HALF_W * 2, h: RING_R - INNER0 + 12 },
  };
}
