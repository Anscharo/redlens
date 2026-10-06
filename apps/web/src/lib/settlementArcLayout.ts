// A Prime's settlement month as a rainbow over one centre on the baseline:
// Venues at the left foot (angle π), the Prime at the apex (3π/2), Sky at
// the right foot (2π). Angles grow clockwise on screen.
//
// The Prime is an outlined bar across the apex, spanning exactly the bands
// drawn that month. The OUTER lane runs clockwise. Innermost is what the
// Prime keeps, one band that ends at the bar. Outside it, one band per venue
// carries that venue's cost of funds + Sky Direct Exposure through the bar
// without stopping, on to Sky — together the amount due from the Prime to
// Sky (A.2.4.1.2.2.1.1.2). The INNER lane runs counterclockwise, Sky →
// Prime, into the bar: the demand side (A.2.4.1.2.2.1.1.1). It stacks
// inward from the gap between the lanes, so the two lanes stay close
// however thin the demand side is. The lanes are never netted, so each is
// drawn whole, with one arrowhead and one dash overlay per lane.
//
// One width scale for both lanes: the larger lane fills BAND. The radii are
// fixed, so a month change only re-widths bands — the arch never moves.
import type { StreamModel } from "@/lib/settlementStreams";
import { arcArrowHead, arcPath } from "./arcGeometry";

export const BAND = 104;
/** The demand lane's outer edge; its bands stack inward from here. */
const INNER_OUT = 160;
export const INNER0 = INNER_OUT - BAND;
const LANE_GAP = 16;
export const OUTER0 = INNER_OUT + LANE_GAP;
/** Half the Prime bar's width. */
export const PRIME_HALF = 5;
export const OUTER_END = OUTER0 + BAND;
const HEAD_LEN = 14;
export const HEAD_FLARE = 4;
/** Venues drawn one by one; the rest fold into one "Other venues" band. */
export const ARC_TOP_N = 5;
export const ARC_OTHER_ID = "_arc_other";
/** Thinnest band drawn, so a cent-sized figure is still visible. */
const MIN_W = 1.5;
/** Thinnest venue band: a venue is named on its band, so it gets room for
 *  a line of text even when its amount is small. */
const VENUE_MIN_W = 6;
/** Each venue band starts this much further up the arch than the one inside
 *  it, so venues read as separate sources joining the flow rather than one
 *  block leaving one place. */
const STAGGER = 0.11;
/** Figures under half a dollar draw nothing. */
const NEAR = 0.5;
const LEFT = Math.PI;
const APEX = 1.5 * Math.PI;
const RIGHT = 2 * Math.PI;
/** Demand series inward from the circle: the cited ones first, GAR (no
 *  Atlas term) last. */
const INNER_ORDER = ["agentRate", "distributionRewards", "chroniclePoints", "gar"];

/** Room left of the arch for the venue names, which sit beside each band's
 *  start. */
const LABEL_GUTTER = 170;
export const CX = LABEL_GUTTER + OUTER_END + HEAD_FLARE + 12;
export const CY = OUTER_END + 52;
export const WIDTH = CX + OUTER_END + HEAD_FLARE + 12;
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
  /** Where the venue's name ends: just left of where its band starts,
   *  level with it. */
  labelAt: { x: number; y: number };
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
  /** The Prime bar's radial span: the bands actually drawn, inside out. */
  prime: { r0: number; r1: number } | null;
}

const width = (v: number, scale: number, min = MIN_W) => Math.max(min, Math.abs(v) * scale);
/** A name's anchor beside a band of radius r and width w starting at angle
 *  a: level with the start, clear of the band's outer corner. */
const labelAt = (r: number, w: number, a: number) => ({ x: CX + (r + w / 2) * Math.cos(a) - 8, y: CY + r * Math.sin(a) });
/** The angle at which radius r meets the Prime bar's side. */
const primeEdge = (r: number, side: 1 | -1) => APEX + (side * PRIME_HALF) / r;

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
function stack<T extends { value: number }>(rows: T[], r0: number, scale: number, dir: 1 | -1 = 1, min = MIN_W) {
  let edge = r0;
  const out = rows.map((row) => {
    const w = width(row.value, scale, min);
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
  const kept = keptStack.out[0] ? { ...keptStack.out[0], d: arcPath(CX, CY, keptStack.out[0].r, LEFT, primeEdge(keptStack.out[0].r, -1)) } : null;
  const v = stack(venues, keptStack.edge, scale, 1, VENUE_MIN_W);
  const start = (i: number) => LEFT + i * STAGGER;
  const outer = v.out.length ? laneEnd(keptStack.edge, v.edge, start(v.out.length - 1), RIGHT, 1) : null;
  const d = stack(demandRows, INNER_OUT, scale, -1);
  const inner = d.out.length ? laneEnd(d.edge, INNER_OUT, RIGHT, primeEdge((d.edge + INNER_OUT) / 2, 1), -1) : null;
  return {
    kept,
    venues: v.out.map((b, i) => ({ ...b, d: arcPath(CX, CY, b.r, start(i), outer!.stop), labelAt: labelAt(b.r, b.w, start(i)) })),
    demand: d.out.map((b) => ({ key: b.key, value: b.value, r: b.r, w: b.w, loss: b.loss, d: arcPath(CX, CY, b.r, RIGHT, inner!.stop) })),
    outer,
    inner,
    prime: primeSpan(d.out.length ? d.edge : null, v.out.length ? v.edge : kept ? keptStack.edge : null),
  };
}

/** The bar spans from the demand lane's inner edge to the outer lane's outer
 *  edge; with one lane empty, just the other lane. */
function primeSpan(innerEdge: number | null, outerEdge: number | null): ArcLayout["prime"] {
  if (innerEdge === null && outerEdge === null) return null;
  return { r0: innerEdge ?? OUTER0, r1: outerEdge ?? INNER_OUT };
}
