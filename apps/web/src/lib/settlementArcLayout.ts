// A Prime's settlement month as one circle, every flow clockwise: venues at
// the left (angle π), the Prime at the top (3π/2), Sky at the right (0).
// Angles grow clockwise on screen.
//
// OUTER lane, the top half. Each venue's revenue runs up to the Prime's
// left side. From its right side, in the same venue order, each venue's
// cost of funds runs on to Sky in the venue's colour: the Atlas charges it
// venue by venue (Instance Expense, A.2.4.1.2.2.1.1.2.2.1.1). The widths
// are Soter's per-venue figures, so a venue whose cost exceeds its revenue
// leaves wider than it arrived. Whatever of the revenue does not leave is
// kept, filled in the Prime node; a cost larger than all the revenue is a
// striped shortfall there. Innermost, each venue's Sky Direct Exposure runs
// past the Prime straight to Sky, so it meets cost of funds at Sky with no
// gap: together they are the amount due from the Prime to Sky
// (A.2.4.1.2.2.1.1.2).
//
// INNER lane, three quarters of the circle: from Sky down round the bottom,
// past the venues, up into the Prime. The demand side (A.2.4.1.2.2.1.1.1).
//
// Each node is one bar across exactly the bands meeting it, so its length
// is their amounts on the one scale (plus the fixed gap between lanes).
// At the Prime: the demand received, SDE passing through, and the pool of
// venue revenue (or cost of funds when that is larger). What stays — kept,
// revenue less cost of funds — is the pool's outer part with no band
// leaving it, filled in. At Sky: the demand paid out, and SDE plus cost of
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
export const HEIGHT = CY + INNER_OUT + 16;

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
    /** The part of the pool no band leaves: kept, or the shortfall. */
    kept: (Span & { loss: boolean }) | null;
  };
  /** One node across every band meeting Sky: the demand side out, and
   *  SDE plus cost of funds in. */
  sky: Span | null;
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
  const rev = stack(revRows, sde.edge, scale, 1, VENUE_MIN_W);
  const cof = stack(cofRows, sde.edge, scale, 1, VENUE_MIN_W);
  const cofEdge = cof.edge;
  const poolEdge = Math.max(rev.edge, cofEdge);
  const ns = sde.out.length;
  const nr = rev.out.length;
  const toSkyR = (OUTER0 + cofEdge) / 2;
  const toSky = cofEdge > OUTER0 ? laneEnd(OUTER0, cofEdge, APEX, skyEdge(toSkyR, -1)) : null;
  const revenue = nr ? laneEnd(sde.edge, rev.edge, start(ns + nr - 1), primeEdge((sde.edge + rev.edge) / 2, -1)) : null;
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
    prime: {
      span: nodeSpan(d.out.length ? d.edge : null, poolEdge > sde.edge ? sde.edge : null, poolEdge > sde.edge ? poolEdge : INNER_OUT),
      kept: rev.edge > cofEdge ? keptSpan(cofEdge, rev.edge, false) : keptSpan(rev.edge, cofEdge, true),
    },
    sky: nodeSpan(d.out.length ? d.edge : null, cofEdge > OUTER0 ? OUTER0 : null, cofEdge > OUTER0 ? cofEdge : INNER_OUT),
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

function keptSpan(r0: number, r1: number, loss: boolean) {
  const s = span(r0, r1);
  return s ? { ...s, loss } : null;
}
