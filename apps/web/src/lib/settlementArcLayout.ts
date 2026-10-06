// A Prime's settlement month as one circle, every flow clockwise: venues at
// the left (angle π), the Prime at the top (3π/2), Sky at the right (0).
// Angles grow clockwise on screen.
//
// OUTER lane, the top half. Each venue's revenue runs up to the Prime and
// stops: it pools there. Out of the pool the Prime pays Sky its cost of
// funds, one Prime-level band on to Sky, since it is a charge on the USDS
// the Prime borrowed (A.3.1.2.5) rather than any one venue's money. Inside
// the pool, each venue's Sky Direct Exposure runs past the Prime straight
// to Sky, through a gap in the Prime node. SDE sits innermost so it meets
// cost of funds at Sky with no gap: together they are the amount due from
// the Prime to Sky (A.2.4.1.2.2.1.1.2).
//
// INNER lane, three quarters of the circle: from Sky down round the bottom,
// past the venues, up into the Prime. The demand side (A.2.4.1.2.2.1.1.1).
//
// Node lengths are amounts on the one scale the bands use. The Prime node
// has two pieces: the pool (venue revenue, or cost of funds when that is
// larger) and the demand received. What stays — kept, revenue less cost of
// funds — is the pool's outer part with no band leaving it, filled in.
// Sky's node has the to-Sky piece and the from-Sky piece. The two amounts
// are never netted, so neither node is drawn as one total.
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
const HEAD_LEN = 14;
export const HEAD_FLARE = 4;
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

/** Room left of the circle for the venue names, right of it for Sky's. */
const LABEL_GUTTER = 170;
const SKY_GUTTER = 120;
export const CX = LABEL_GUTTER + OUTER_END + HEAD_FLARE + 12;
export const CY = OUTER_END + 52;
export const WIDTH = CX + OUTER_END + SKY_GUTTER;
export const HEIGHT = CY + INNER_OUT + HEAD_FLARE + 16;

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

export interface ArcLayout {
  sde: VenueBand[];
  revenue: VenueBand[];
  cof: ArcBand | null;
  demand: ArcBand[];
  lanes: { sde: LaneEnd | null; revenue: LaneEnd | null; toSky: LaneEnd | null; demand: LaneEnd | null };
  prime: {
    /** Venue revenue (or cost of funds, if larger) arriving. */
    pool: Span | null;
    /** The part of the pool no band leaves: kept, or the shortfall. */
    kept: (Span & { loss: boolean }) | null;
    demand: Span | null;
  };
  sky: { toSky: Span | null; fromSky: Span | null };
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
 *  `from` to `tip`; `stop` is where its bands end. */
function laneEnd(r0: number, r1: number, from: number, tip: number): LaneEnd & { stop: number } {
  const r = (r0 + r1) / 2;
  const w = r1 - r0;
  const stop = tip - HEAD_LEN / r;
  return { stop, w, head: arcArrowHead(CX, CY, r, w, stop, 1, HEAD_LEN, HEAD_FLARE), flow: arcPath(CX, CY, r, from, stop) };
}

/** Venue bands from staggered starts to `stop`; band i starts at slot i0+i. */
function venueBands(rows: (ArcFlow & { r: number; w: number; loss: boolean })[], i0: number, stop: number): VenueBand[] {
  return rows.map((b, i) => ({ ...b, d: arcPath(CX, CY, b.r, start(i0 + i), stop), labelAt: labelAt(b.r, b.w, start(i0 + i)) }));
}

export function layoutSettlementArc(m: StreamModel): ArcLayout {
  const src = arcSources(m);
  const cofV = Math.abs(m.cof) >= NEAR ? m.cof : 0;
  const demandRows = [...m.demand].sort((a, b) => INNER_ORDER.indexOf(a.key) - INNER_ORDER.indexOf(b.key));
  const max = Math.max(total(src.sde) + Math.max(total(src.revenue), Math.abs(cofV)), total(demandRows));
  const scale = max > 0 ? BAND / max : 0;

  const sde = stack(src.sde, OUTER0, scale, 1, VENUE_MIN_W);
  const rev = stack(src.revenue, sde.edge, scale, 1, VENUE_MIN_W);
  const cofEdge = cofV ? sde.edge + width(cofV, scale) : sde.edge;
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
  const cofR = (sde.edge + cofEdge) / 2;
  return {
    sde: venueBands(sde.out, 0, toSky?.stop ?? SKY),
    revenue: venueBands(rev.out, ns, revenue?.stop ?? APEX),
    cof: cofV && toSky ? { key: "cof", value: cofV, r: cofR, w: cofEdge - sde.edge, loss: cofV < 0, d: arcPath(CX, CY, cofR, primeEdge(cofR, 1), toSky.stop) } : null,
    demand: d.out.map((b) => ({ key: b.key, value: b.value, r: b.r, w: b.w, loss: b.loss, d: arcPath(CX, CY, b.r, skyEdge(b.r, 1), demand!.stop) })),
    lanes: { sde: sdeFlow, revenue, toSky, demand },
    prime: {
      pool: span(sde.edge, poolEdge),
      kept: rev.edge > cofEdge ? keptSpan(cofEdge, rev.edge, false) : keptSpan(rev.edge, cofEdge, true),
      demand: span(d.edge, INNER_OUT),
    },
    sky: { toSky: span(OUTER0, cofEdge), fromSky: span(d.edge, INNER_OUT) },
  };
}

function keptSpan(r0: number, r1: number, loss: boolean) {
  const s = span(r0, r1);
  return s ? { ...s, loss } : null;
}
