// A Prime's settlement month as one circle, every flow clockwise: venues at
// the left (angle π), the Prime at the top (3π/2), Sky at the right (0).
// Angles grow clockwise on screen.
//
// OUTER lane, the top half. Each venue's revenue runs up to the Prime's
// left side. From its right side, in the same venue order, each venue's
// cost of funds runs on to Sky in the venue's colour: the Atlas charges it
// venue by venue (Instance Expense, A.2.4.1.2.2.1.1.2.2.1.1). The widths
// are Soter's per-venue figures, so a venue whose cost exceeds its revenue
// leaves wider than it arrived. What the Prime keeps is filled in its
// node from the middle up; a loss (cost larger than all the revenue) is
// striped from the middle down. Innermost, each venue's Sky Direct Exposure runs
// past the Prime straight to Sky, where it meets cost of funds under one
// arrowhead: together they are the amount due from the Prime to Sky
// (A.2.4.1.2.2.1.1.2). SDE_GAP of whitespace keeps it apart from the venues.
//
// INNER lane, three quarters of the circle: from Sky down round the bottom,
// past the venues, up into the Prime. The demand side (A.2.4.1.2.2.1.1.1).
//
// Each node is one bar across exactly the bands meeting it, so its length
// is their amounts on the one scale (plus the fixed gap between lanes).
// At the Prime: the demand received, SDE passing through, and the pool of
// venue revenue (or cost of funds when that is larger). Kept — revenue
// less cost of funds — is filled from the node's middle, up for kept and
// down for a loss, on the band scale. At Sky: the demand paid out, and SDE plus cost of
// funds arriving, each band still its own amount, never netted.
//
// One width scale for both lanes: the larger fills BAND. The radii are
// fixed, so a month change only re-widths bands — the circle never moves.
import type { StreamModel } from "@/lib/settlementStreams";
import { arcArrowHead, arcPath } from "./arcGeometry";
import { NEAR, arcSources, type ArcFlow } from "./settlementArcRows";

export const BAND = 104;
/** The demand lane's outer edge; its bands stack inward from here. */
export const INNER_OUT = 160;
const LANE_GAP = 16;
export const OUTER0 = INNER_OUT + LANE_GAP;
export const OUTER_END = OUTER0 + BAND;
/** Half the Prime node's and Sky node's thickness. */
export const PRIME_HALF = 7;
export const SKY_HALF = 4;
/** Every arrowhead has the same tip angle: its length is this share of its
 *  base. The base is the lane's width, so a head lines up with its lane,
 *  except that it is never narrower than HEAD_MIN_W: a thin lane's head
 *  overhangs it evenly so it can still be seen. */
const HEAD_RATIO = 0.6;
const HEAD_MIN_W = 16;
/** Clear space between an arrow's tip and the node it reaches. */
export const ARRIVE_GAP = 8;
/** BAND's worth of dollars is never less than this, so a small month (a
 *  demand-only Prime's $31k) is drawn thin, not stretched to fill BAND as
 *  if it were tens of millions. */
const FULL_SCALE_USD = 10_000_000;
/** Thinnest band drawn, so a cent-sized figure is still visible. */
const MIN_W = 1.5;
/** Thinnest venue band, so each named band has some girth. */
const VENUE_MIN_W = 6;
/** Whitespace between the SDE bands and the venue bands outside them, so
 *  the pass-through reads apart from the Prime's own revenue and cost. */
const SDE_GAP = 2;
/** Each venue band starts this much further up the arch than the one inside
 *  it, so venues read as separate sources rather than one block. */
const STAGGER = 0.11;
const LEFT = Math.PI;
const APEX = 1.5 * Math.PI;
const SKY = 2 * Math.PI;
/** Demand series inward from the gap: the cited ones first, GAR (no Atlas
 *  term) last. */
const INNER_ORDER = ["agentRate", "distributionRewards", "chroniclePoints", "gar"];

/** Room left of the circle before the venue names (the figure widens left
 *  to fit them whole), and right of it for Sky's. */
const LABEL_GUTTER = 24;
const SKY_GUTTER = 120;
export const CX = LABEL_GUTTER + OUTER_END + 12;
export const CY = OUTER_END + 64;
export const WIDTH = CX + OUTER_END + SKY_GUTTER;
/** Bottom of the figure: the demand lane plus its series names below it. */
export const HEIGHT = CY + INNER_OUT + 32;
/** Room above the outermost band for the Prime's name and kept figure. */
const TOP_ROOM = 52;

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
  venue: string;
  label: string;
  /** Where the venue's name ends: just left of its band's start. */
  labelAt: { x: number; y: number };
}

/** One lane's arrowhead (absent where it has none) and dash overlay. */
export interface LaneEnd {
  head: string | null;
  flow: string;
  w: number;
}

/** A radial span [r0, r1] of a node. */
export interface Span {
  r0: number;
  r1: number;
}

/** A demand series' name, outside the lane at the bottom of the circle,
 *  with a leader from its band to the text. */
export interface DemandLabel {
  key: string;
  value: number;
  x: number;
  y: number;
  leader: string;
}

export interface ArcLayout {
  sde: VenueBand[];
  revenue: VenueBand[];
  /** Each venue's cost of funds, from the Prime on to Sky. */
  cof: VenueBand[];
  demand: ArcBand[];
  demandLabels: DemandLabel[];
  lanes: { sde: LaneEnd | null; revenue: LaneEnd | null; toSky: LaneEnd | null; demand: LaneEnd | null };
  prime: {
    /** One node across every band meeting the Prime: the demand side in,
     *  SDE passing through, the pool of venue revenue (or cost of funds,
     *  if larger). */
    span: Span | null;
    /** What the Prime keeps, on the band scale, measured from the middle
     *  of the node: up (outward) for kept, down (inward) for a loss. */
    kept: (Span & { loss: boolean }) | null;
    /** The node's middle, where kept and loss start. */
    mid: number | null;
  };
  /** One node across every band meeting Sky: the demand side out, and
   *  SDE plus cost of funds in. */
  sky: Span | null;
  /** The outermost radius drawn above the centre line (the outer lane's
   *  edge, or the demand lane's when there is no outer lane). The figure is
   *  cropped to it, so a small month is not drawn under empty space. */
  outerEdge: number;
  /** The figure's top y. */
  top: number;
}

const width = (v: number, scale: number, min = MIN_W) => Math.max(min, Math.abs(v) * scale);
const labelAt = (r: number, w: number, a: number) => ({ x: CX + (r + w / 2) * Math.cos(a) - 8, y: CY + r * Math.sin(a) });
/** The angle at which radius r meets the Prime node's left (−1) or right
 *  (1) side, or Sky's node's top (−1) or bottom (1). */
const primeEdge = (r: number, side: 1 | -1) => APEX + (side * PRIME_HALF) / r;
const skyEdge = (r: number, side: 1 | -1) => (side === 1 ? 0 : SKY) + (side * SKY_HALF) / r;
const start = (i: number) => LEFT + i * STAGGER;
const total = (rows: { value: number }[]) => rows.reduce((n, r) => n + Math.abs(r.value), 0);
const span = (r0: number, r1: number): Span | null => (r1 - r0 >= NEAR ? { r0, r1 } : null);

/** Bands stacked from r0, outward (dir 1) or inward (−1). */
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

/** The clockwise head and dash line for a lane spanning [r0, r1] from
 *  `from` to a node's side at `edge`; the tip stops ARRIVE_GAP short of it
 *  and `stop` is where the lane's bands end. */
function laneEnd(r0: number, r1: number, from: number, edge: number): LaneEnd & { stop: number } {
  const r = (r0 + r1) / 2;
  const w = r1 - r0;
  const base = Math.max(w, HEAD_MIN_W);
  const len = base * HEAD_RATIO;
  const stop = edge - (ARRIVE_GAP + len) / r;
  return { stop, w, head: arcArrowHead(CX, CY, r, w, stop, 1, len, (base - w) / 2), flow: arcPath(CX, CY, r, from, stop) };
}

/** Venue bands from staggered starts to `stop`; band i starts at slot i0+i. */
function venueBands(rows: (ArcFlow & { r: number; w: number; loss: boolean })[], i0: number, stop: number): VenueBand[] {
  return rows.map((b, i) => ({ ...b, d: arcPath(CX, CY, b.r, start(i0 + i), stop), labelAt: labelAt(b.r, b.w, start(i0 + i)) }));
}

export function layoutSettlementArc(m: StreamModel): ArcLayout {
  const src = arcSources(m);
  const revRows = src.revenue.filter((v) => Math.abs(v.value) >= NEAR);
  const cofRows = src.revenue.filter((v) => Math.abs(v.cof) >= NEAR).map((v) => ({ ...v, value: v.cof }));
  const demandRows = [...m.demand].sort((a, b) => INNER_ORDER.indexOf(a.key) - INNER_ORDER.indexOf(b.key));
  const max = Math.max(total(src.sde) + Math.max(total(revRows), total(cofRows)), total(demandRows));
  const scale = max > 0 ? BAND / Math.max(max, FULL_SCALE_USD) : 0;

  const sde = stack(src.sde, OUTER0, scale, 1, VENUE_MIN_W);
  // Left of the Prime the venues stack by revenue; right of it, in the same
  // order, by cost of funds. What a venue's revenue band has and its cost
  // band lacks stays with the Prime.
  const ns = sde.out.length;
  const venue0 = ns ? sde.edge + SDE_GAP : OUTER0;
  const rev = stack(revRows, venue0, scale, 1, VENUE_MIN_W);
  const cof = stack(cofRows, venue0, scale, 1, VENUE_MIN_W);
  // The to-Sky lane spans SDE, the gap and cost of funds; with no cost of
  // funds it is SDE alone.
  const cofEdge = cof.out.length ? cof.edge : sde.edge;
  const poolEdge = Math.max(rev.edge, cof.edge);
  const nr = rev.out.length;
  const toSkyR = (OUTER0 + cofEdge) / 2;
  const toSky = cofEdge > OUTER0 ? laneEnd(OUTER0, cofEdge, APEX, skyEdge(toSkyR, -1)) : null;
  const revenue = nr ? laneEnd(venue0, rev.edge, start(ns + nr - 1), primeEdge((venue0 + rev.edge) / 2, -1)) : null;
  const sdeFlow = ns ? { head: null, w: sde.edge - OUTER0, flow: arcPath(CX, CY, (OUTER0 + sde.edge) / 2, start(ns - 1), APEX) } : null;
  const d = stack(demandRows, INNER_OUT, scale, -1);
  const demandR = (d.edge + INNER_OUT) / 2;
  const demand = d.out.length ? laneEnd(d.edge, INNER_OUT, skyEdge(demandR, 1), primeEdge(demandR, -1)) : null;
  return {
    sde: venueBands(sde.out, 0, toSky?.stop ?? SKY),
    revenue: venueBands(rev.out, ns, revenue?.stop ?? APEX),
    cof: toSky ? cof.out.map((b) => ({ ...b, key: `${b.key}::cof`, d: arcPath(CX, CY, b.r, primeEdge(b.r, 1), toSky.stop), labelAt: labelAt(b.r, b.w, APEX) })) : [],
    demand: d.out.map((b) => ({ key: b.key, value: b.value, r: b.r, w: b.w, loss: b.loss, d: arcPath(CX, CY, b.r, skyEdge(b.r, 1), demand!.stop) })),
    demandLabels: d.out.map((b, i) => demandLabel(b, i)),
    lanes: { sde: sdeFlow, revenue, toSky, demand },
    prime: primeNode(nodeSpan(d.out.length ? d.edge : null, poolEdge > venue0 ? venue0 : null, poolEdge > venue0 ? poolEdge : INNER_OUT), m.kept, scale),
    sky: nodeSpan(d.out.length ? d.edge : null, cofEdge > OUTER0 ? OUTER0 : null, cofEdge > OUTER0 ? cofEdge : INNER_OUT),
    outerEdge: Math.max(poolEdge, cofEdge, INNER_OUT),
    top: CY - Math.max(poolEdge, cofEdge, INNER_OUT) - TOP_ROOM,
  };
}

/** Demand series are named one by one round the bottom-left of the circle,
 *  where nothing else is drawn: series i at DEMAND_LABEL0 + i·DEMAND_LABEL_STEP,
 *  a leader running out from its band past the lane to the text. */
const DEMAND_LABEL0 = 0.6 * Math.PI;
const DEMAND_LABEL_STEP = 0.1 * Math.PI;
function demandLabel(b: { key: string; value: number; r: number }, i: number): DemandLabel {
  const a = DEMAND_LABEL0 + i * DEMAND_LABEL_STEP;
  const at = (r: number) => ({ x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) });
  const from = at(b.r);
  const to = at(INNER_OUT + 10);
  const text = at(INNER_OUT + 14);
  return { key: b.key, value: b.value, x: text.x, y: text.y, leader: `M${from.x.toFixed(1)},${from.y.toFixed(1)} L${to.x.toFixed(1)},${to.y.toFixed(1)}` };
}

/** A node from the demand lane's inner edge (or, with no demand, the outer
 *  lane's) to r1; null when neither lane meets it. */
function nodeSpan(demandEdge: number | null, outerStart: number | null, r1: number): Span | null {
  const r0 = demandEdge ?? outerStart;
  return r0 === null ? null : span(r0, r1);
}

/** The Prime node with kept drawn from its middle: up by kept on the band
 *  scale, or down by a loss, never past the node's ends. */
function primeNode(node: Span | null, kept: number, scale: number): ArcLayout["prime"] {
  if (!node) return { span: null, kept: null, mid: null };
  const mid = (node.r0 + node.r1) / 2;
  if (Math.abs(kept) < NEAR) return { span: node, kept: null, mid };
  const w = width(kept, scale);
  const k = kept > 0 ? { r0: mid, r1: Math.min(mid + w, node.r1), loss: false } : { r0: Math.max(mid - w, node.r0), r1: mid, loss: true };
  return { span: node, kept: k, mid };
}

/** The box one Prime's circle is drawn in: left far enough for every
 *  month's venue names, top high enough for every month's outermost band.
 *  Fixed across the Prime's months, so changing month never moves the
 *  circle. `left` measures one layout's leftmost name. */
export interface ArcFrame {
  left: number;
  top: number;
}
export function arcFrame(layouts: readonly ArcLayout[], left: (l: ArcLayout) => number): ArcFrame {
  return {
    left: Math.min(0, ...layouts.map(left)),
    top: Math.min(CY - INNER_OUT - 52, ...layouts.map((l) => l.top)),
  };
}
