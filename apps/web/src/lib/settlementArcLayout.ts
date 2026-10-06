// A Prime's settlement month as a rainbow over one centre on the baseline:
// Venues at the left foot (angle π), the Prime at the apex (3π/2), Sky at
// the right foot (2π). Angles grow clockwise on screen.
//
// The Prime is a circle at the apex, between the two lanes. The OUTER lane
// runs clockwise. Innermost is what the Prime keeps, one band that ends at
// the circle. Outside it, one band per venue carries that
// venue's cost of funds + Sky Direct Exposure through the Prime without
// stopping, on to Sky — together the amount due from the Prime to Sky
// (A.2.4.1.2.2.1.1.2). The INNER lane runs counterclockwise, Sky → Prime,
// into the circle: the demand side (A.2.4.1.2.2.1.1.1). It stacks inward
// from the circle, so however thin it is it still reaches the Prime. The lanes are never netted, so each
// is drawn whole, with one arrowhead and one dash overlay per lane.
//
// One width scale for both lanes: the larger lane fills BAND. The radii are
// fixed, so a month change only re-widths bands — the arch never moves.
import type { StreamModel } from "@/lib/settlementStreams";
import { arcArrowHead, arcPath } from "./arcGeometry";

export const BAND = 72;
/** The demand lane's outer edge; its bands stack inward from here. */
const INNER_OUT = 160;
export const INNER0 = INNER_OUT - BAND;
export const PRIME_R = 20;
/** The Prime circle's centre radius: it overlaps each lane by 4px. */
export const PRIME_RC = INNER_OUT + PRIME_R - 4;
export const OUTER0 = PRIME_RC + PRIME_R - 4;
export const OUTER_END = OUTER0 + BAND;
const HEAD_LEN = 14;
export const HEAD_FLARE = 4;
/** Venues drawn one by one; the rest fold into one "Other venues" band. */
export const ARC_TOP_N = 5;
export const ARC_OTHER_ID = "_arc_other";
/** Thinnest band drawn, so a cent-sized figure is still visible. */
const MIN_W = 1.5;
/** Figures under half a dollar draw nothing. */
const NEAR = 0.5;
const LEFT = Math.PI;
const APEX = 1.5 * Math.PI;
const RIGHT = 2 * Math.PI;
/** Demand series inward from the circle: the cited ones first, GAR (no
 *  Atlas term) last. */
const INNER_ORDER = ["agentRate", "distributionRewards", "chroniclePoints", "gar"];

export const CX = OUTER_END + HEAD_FLARE + 12;
export const CY = OUTER_END + 52;
export const WIDTH = CX * 2;
export const HEIGHT = CY + 68;

export interface ArcBand {
  key: string;
  value: number;
  /** Centreline radius and stroke width. */
  r: number;
  w: number;
  /** Centreline, in the direction the money moves. */
  d: string;
  loss: boolean;
}

export interface VenueBand extends ArcBand {
  label: string;
  /** The band's centreline from the Venues foot to the Prime, for its name. */
  labelD: string;
  cof: number;
  sde: number;
}

/** One lane's shared arrowhead and dash overlay. */
export interface LaneEnd {
  head: string;
  flow: string;
  w: number;
}

export interface ArcLayout {
  kept: ArcBand | null;
  venues: VenueBand[];
  demand: ArcBand[];
  outer: LaneEnd | null;
  inner: LaneEnd | null;
}

const width = (v: number, scale: number) => Math.max(MIN_W, Math.abs(v) * scale);
/** The angle at which a demand arrow travelling at radius r touches the
 *  circle (law of cosines, aiming just inside its edge). A lane too thick
 *  for its middle to reach the circle stops just right of the apex. */
function innerTip(r: number): number {
  const reach = PRIME_R * 0.9;
  const cos = (r * r + PRIME_RC * PRIME_RC - reach * reach) / (2 * r * PRIME_RC);
  return APEX + (cos <= 1 ? Math.acos(cos) : (PRIME_R * 0.5) / r);
}

type VenueFlow = { key: string; label: string; cof: number; sde: number; value: number };

/** Each venue's flow to Sky, largest first; past ARC_TOP_N, one Other. */
export function arcVenues(m: StreamModel): VenueFlow[] {
  const rows = m.venues
    .map((v) => ({ key: v.id, label: v.label, cof: v.cof, sde: v.sde, value: v.cof + v.sde }))
    .filter((v) => Math.abs(v.value) >= NEAR)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  if (rows.length <= ARC_TOP_N + 1) return rows;
  const tail = rows.slice(ARC_TOP_N);
  const sum = (k: "cof" | "sde" | "value") => tail.reduce((n, v) => n + v[k], 0);
  return [...rows.slice(0, ARC_TOP_N), { key: ARC_OTHER_ID, label: "Other venues", cof: sum("cof"), sde: sum("sde"), value: sum("value") }];
}

/** Bands stacked from r0, outward (dir 1) or inward (−1); returns them and
 *  the far edge. */
function stack<T extends { value: number }>(rows: T[], r0: number, scale: number, dir: 1 | -1 = 1) {
  let edge = r0;
  const out = rows.map((row) => {
    const w = width(row.value, scale);
    const r = edge + (dir * w) / 2;
    edge += dir * w;
    return { ...row, r, w, loss: row.value < 0 };
  });
  return { out, edge };
}

/** The shared head and dash line for a lane spanning [r0, r1] that ends at
 *  `tip`, travelling in direction `dir`. Returns the angle bands stop at. */
function laneEnd(r0: number, r1: number, from: number, tip: number, dir: 1 | -1): LaneEnd & { stop: number } {
  const r = (r0 + r1) / 2;
  const w = r1 - r0;
  const stop = tip - (dir * HEAD_LEN) / r;
  return { stop, w, head: arcArrowHead(CX, CY, r, w, stop, dir, HEAD_LEN, HEAD_FLARE), flow: arcPath(CX, CY, r, from, stop) };
}

export function layoutSettlementArc(m: StreamModel): ArcLayout {
  const venues = arcVenues(m);
  const keptV = Math.abs(m.kept) >= NEAR ? m.kept : 0;
  const demandRows = [...m.demand].sort((a, b) => INNER_ORDER.indexOf(a.key) - INNER_ORDER.indexOf(b.key));
  const outerSum = Math.abs(keptV) + venues.reduce((n, v) => n + Math.abs(v.value), 0);
  const innerSum = demandRows.reduce((n, d) => n + Math.abs(d.value), 0);
  const max = Math.max(outerSum, innerSum);
  const scale = max > 0 ? BAND / max : 0;

  const keptStack = stack(keptV ? [{ key: "kept", value: keptV }] : [], OUTER0, scale);
  const kept = keptStack.out[0] ? { ...keptStack.out[0], d: arcPath(CX, CY, keptStack.out[0].r, LEFT, APEX) } : null;
  const v = stack(venues, keptStack.edge, scale);
  const outer = v.out.length ? laneEnd(keptStack.edge, v.edge, LEFT, RIGHT, 1) : null;
  const d = stack(demandRows, INNER_OUT, scale, -1);
  const inner = d.out.length ? laneEnd(d.edge, INNER_OUT, RIGHT, innerTip((d.edge + INNER_OUT) / 2), -1) : null;
  return {
    kept,
    venues: v.out.map((b) => ({ ...b, d: arcPath(CX, CY, b.r, LEFT, outer!.stop), labelD: arcPath(CX, CY, b.r, LEFT, APEX - 8 / b.r) })),
    demand: d.out.map((b) => ({ key: b.key, value: b.value, r: b.r, w: b.w, loss: b.loss, d: arcPath(CX, CY, b.r, RIGHT, inner!.stop) })),
    outer,
    inner,
  };
}
