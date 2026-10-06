// A Prime's settlement month as a rainbow over one centre on the baseline:
// venues at the left foot (angle π), the Prime at the apex (3π/2), Sky at
// the right foot (2π). Angles grow clockwise on screen.
//
// OUTER lane, clockwise. Each venue's revenue to the Prime runs up to the
// Prime bar and stops there: it pools at the Prime. Out of the pool the
// Prime pays Sky its cost of funds, one Prime-level band on to Sky, since
// it is a charge on the USDS the Prime borrowed (A.3.1.2.5) rather than any
// one venue's money; what is left is kept, a short stub ending just past
// the bar. When cost of funds exceeds the pool, the difference is a striped
// shortfall stub entering the bar instead. Outside the pool, each venue's
// Sky Direct Exposure runs past the Prime straight to Sky. Cost of funds
// plus SDE is the amount due from the Prime to Sky (A.2.4.1.2.2.1.1.2).
//
// INNER lane, counterclockwise, Sky → Prime: the demand side
// (A.2.4.1.2.2.1.1.1). It stacks inward from the gap between the lanes, so
// the lanes stay close however thin the demand side is. The lanes are
// never netted, so each is drawn whole.
//
// One width scale for both lanes: the larger fills BAND. The radii are
// fixed, so a month change only re-widths bands — the arch never moves.
import type { StreamModel } from "@/lib/settlementStreams";
import { arcArrowHead, arcPath } from "./arcGeometry";
import { NEAR, arcSources, type ArcFlow } from "./settlementArcRows";

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
/** Thinnest band drawn, so a cent-sized figure is still visible. */
const MIN_W = 1.5;
/** Thinnest venue band, so each named band has some girth. */
const VENUE_MIN_W = 6;
/** Each venue band starts this much further up the arch than the one inside
 *  it, so venues read as separate sources rather than one block. */
const STAGGER = 0.11;
/** Arc length of the kept and shortfall stubs beside the bar. */
const STUB = 26;
const LEFT = Math.PI;
const APEX = 1.5 * Math.PI;
const RIGHT = 2 * Math.PI;
/** Demand series inward from the gap: the cited ones first, GAR (no Atlas
 *  term) last. */
const INNER_ORDER = ["agentRate", "distributionRewards", "chroniclePoints", "gar"];

/** Room left of the arch for the venue names beside each band's start. */
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
  venue: string;
  label: string;
  /** Where the venue's name ends: just left of its band's start. */
  labelAt: { x: number; y: number };
}

/** One lane's arrowhead and dash overlay. */
export interface LaneEnd {
  head: string;
  flow: string;
  w: number;
}

export interface ArcLayout {
  revenue: VenueBand[];
  sde: VenueBand[];
  cof: ArcBand | null;
  kept: ArcBand | null;
  shortfall: ArcBand | null;
  demand: ArcBand[];
  lanes: { revenue: LaneEnd | null; cof: LaneEnd | null; sde: LaneEnd | null; demand: LaneEnd | null };
  /** The Prime bar's radial span: the demand lane and the pool, inside out. */
  prime: { r0: number; r1: number } | null;
}

const width = (v: number, scale: number, min = MIN_W) => Math.max(min, Math.abs(v) * scale);
const labelAt = (r: number, w: number, a: number) => ({ x: CX + (r + w / 2) * Math.cos(a) - 8, y: CY + r * Math.sin(a) });
/** The angle at which radius r meets the Prime bar's side. */
const primeEdge = (r: number, side: 1 | -1) => APEX + (side * PRIME_HALF) / r;
const start = (i: number) => LEFT + i * STAGGER;
const total = (rows: { value: number }[]) => rows.reduce((n, r) => n + Math.abs(r.value), 0);

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

/** The head and dash line for a lane spanning [r0, r1] from `from` to
 *  `tip`, travelling in direction `dir`; `stop` is where its bands end. */
function laneEnd(r0: number, r1: number, from: number, tip: number, dir: 1 | -1): LaneEnd & { stop: number } {
  const r = (r0 + r1) / 2;
  const w = r1 - r0;
  const stop = tip - (dir * HEAD_LEN) / r;
  return { stop, w, head: arcArrowHead(CX, CY, r, w, stop, dir, HEAD_LEN, HEAD_FLARE), flow: arcPath(CX, CY, r, from, stop) };
}

/** Venue bands from staggered starts to `stop`; band i starts at slot i0+i. */
function venueBands(rows: (ArcFlow & { r: number; w: number; loss: boolean })[], i0: number, stop: number): VenueBand[] {
  return rows.map((b, i) => ({ ...b, d: arcPath(CX, CY, b.r, start(i0 + i), stop), labelAt: labelAt(b.r, b.w, start(i0 + i)) }));
}

/** Kept (pool wider than cost of funds) as a stub leaving the bar's right
 *  side, or the shortfall (narrower) as a stub entering its left. */
function remainder(poolEdge: number, cofEdge: number, kept: number) {
  const gap = poolEdge - cofEdge;
  if (Math.abs(gap) < NEAR) return { kept: null, shortfall: null };
  const r = (poolEdge + cofEdge) / 2;
  const w = Math.abs(gap);
  const sweep = (PRIME_HALF + STUB) / r;
  if (gap > 0) return { kept: { key: "kept", value: kept, r, w, loss: false, d: arcPath(CX, CY, r, primeEdge(r, 1), APEX + sweep) }, shortfall: null };
  return { kept: null, shortfall: { key: "shortfall", value: kept, r, w, loss: true, d: arcPath(CX, CY, r, APEX - sweep, primeEdge(r, -1)) } };
}

export function layoutSettlementArc(m: StreamModel): ArcLayout {
  const src = arcSources(m);
  const cofV = Math.abs(m.cof) >= NEAR ? m.cof : 0;
  const demandRows = [...m.demand].sort((a, b) => INNER_ORDER.indexOf(a.key) - INNER_ORDER.indexOf(b.key));
  const max = Math.max(Math.max(total(src.revenue), Math.abs(cofV)) + total(src.sde), total(demandRows));
  const scale = max > 0 ? BAND / max : 0;

  const rev = stack(src.revenue, OUTER0, scale, 1, VENUE_MIN_W);
  const cofEdge = cofV ? OUTER0 + width(cofV, scale) : OUTER0;
  const pool = Math.max(rev.edge, cofEdge);
  const sde = stack(src.sde, pool, scale, 1, VENUE_MIN_W);
  const n = rev.out.length;
  const revenueLane = n ? laneEnd(OUTER0, rev.edge, start(n - 1), primeEdge((OUTER0 + rev.edge) / 2, -1), 1) : null;
  const cofR = (OUTER0 + cofEdge) / 2;
  const cofLane = cofV ? laneEnd(OUTER0, cofEdge, primeEdge(cofR, 1), RIGHT, 1) : null;
  const sdeLane = sde.out.length ? laneEnd(pool, sde.edge, start(n + sde.out.length - 1), RIGHT, 1) : null;
  const d = stack(demandRows, INNER_OUT, scale, -1);
  const demandLane = d.out.length ? laneEnd(d.edge, INNER_OUT, RIGHT, primeEdge((d.edge + INNER_OUT) / 2, 1), -1) : null;
  return {
    revenue: venueBands(rev.out, 0, revenueLane?.stop ?? APEX),
    sde: venueBands(sde.out, n, sdeLane?.stop ?? RIGHT),
    cof: cofLane ? { key: "cof", value: cofV, r: cofR, w: cofEdge - OUTER0, loss: cofV < 0, d: arcPath(CX, CY, cofR, primeEdge(cofR, 1), cofLane.stop) } : null,
    ...remainder(rev.edge, cofEdge, m.kept),
    demand: d.out.map((b) => ({ key: b.key, value: b.value, r: b.r, w: b.w, loss: b.loss, d: arcPath(CX, CY, b.r, RIGHT, demandLane!.stop) })),
    lanes: { revenue: revenueLane, cof: cofLane, sde: sdeLane, demand: demandLane },
    prime: primeSpan(d.out.length ? d.edge : null, pool > OUTER0 ? pool : null),
  };
}

/** The bar spans from the demand lane's inner edge to the pool's outer edge;
 *  with one empty, just the other. SDE passes outside it. */
function primeSpan(innerEdge: number | null, outerEdge: number | null): ArcLayout["prime"] {
  if (innerEdge === null && outerEdge === null) return null;
  return { r0: innerEdge ?? OUTER0, r1: outerEdge ?? INNER_OUT };
}
