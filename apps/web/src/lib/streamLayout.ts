// Geometry for a Prime's settlement streams (SettlementStreams.tsx): every
// payment in the month is one directed stream whose width is its amount and
// whose arrowhead points where the money went.
//
//   earned at (venues) ──revenue──▶ PRIME ──cost of funds──▶ SKY (in)
//   venue ── SDE ── behind the Prime, never docking ───────▶ SKY (in)
//                                   PRIME ◀──demand side──── SKY (out)
//                                     └─ kept stops at the Prime (⊣)
//
// Sky's two segments are the two settlement amounts — due from the Prime
// (A.2.4.1.2.2.1.1.2) and due from Sky (A.2.4.1.2.2.1.1.1) — drawn as
// separate lanes and never netted. A negative amount reverses its arrow and
// is drawn in the loss stripes.
import type { DemandKey } from "@/lib/settlements";
import type { StreamModel, VenueStream } from "@/lib/settlementStreams";

export const WIDTH = 860;
/** Venue names and amounts, left of where the streams start. */
export const LABEL_W = 196;
const SRC_X = LABEL_W + 8;
export const NODE_W = 12;
export const PRIME_X = 470;
export const SKY_X = 716;
/** Where the right-hand Sky labels start. */
export const SKY_LABEL_X = SKY_X + NODE_W + 8;
export const TOP = 46;
/** Pixel height the largest column's money is scaled to. */
const BAND = 240;
const ROW_MIN = 15;
const ROW_GAP = 3;
const SDE_GAP = 2;
/** Between the Prime's bar and the demand lane under it. */
const LANE_GAP = 30;
/** The kept stream's length: it leaves the bar and stops. */
export const KEPT_STUB = 36;
const MIN_W = 1.5;

export type StreamKind = "revenue" | "sde" | "cof" | "kept" | "demand";

export interface Stream {
  key: string;
  kind: StreamKind;
  /** The venue row it belongs to, for the shared hover highlight. */
  venue?: string;
  series?: DemandKey;
  value: number;
  /** Drawn width. */
  w: number;
  /** Centreline, drawn from where the money leaves to where it arrives. */
  d: string;
  /** Arrowhead (or, for kept, the stop bar) at the arriving end. */
  head: string;
  loss: boolean;
}

export interface StreamRow {
  id: string;
  label: string;
  synthetic: boolean;
  revenue: number;
  sde: number;
  /** Label baseline centre. */
  y: number;
}

export interface StreamLayout {
  width: number;
  height: number;
  rows: StreamRow[];
  streams: Stream[];
  prime: { x: number; y: number; h: number };
  kept: { value: number; y: number; w: number } | null;
  demand: { y: number; h: number; parts: { key: DemandKey; y: number; h: number }[] } | null;
  sky: { inY: number; inH: number; outY: number; outH: number };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A horizontal-ended cubic from (x0,y0) to (x1,y1) that stops short for an
 *  arrowhead (or a stop bar) whose tip sits exactly on (x1,y1). */
export function streamPath(x0: number, y0: number, x1: number, y1: number, w: number, end: "arrow" | "stop" = "arrow") {
  const dir = Math.sign(x1 - x0) || 1;
  const hl = end === "arrow" ? clamp(w * 0.45, 6, 16) : 0;
  const xe = x1 - dir * hl;
  const mx = (x0 + xe) / 2;
  const d = `M${x0},${y0} C${mx},${y0} ${mx},${y1} ${xe},${y1}`;
  const hw = w / 2 + clamp(w * 0.2, 3, 8);
  const head =
    end === "arrow"
      ? `M${xe},${y1 - hw} L${x1},${y1} L${xe},${y1 + hw} Z`
      : `M${x1},${y1 - hw} L${x1 + dir * 2},${y1 - hw} L${x1 + dir * 2},${y1 + hw} L${x1},${y1 + hw} Z`;
  return { d, head };
}

/** Dollars → pixels, so the tallest column fills BAND. */
export function streamScale(m: StreamModel): number {
  const abs = (pick: (v: VenueStream) => number) => m.venues.reduce((n, v) => n + Math.abs(pick(v)), 0);
  const sde = abs((v) => v.sde);
  const prime = Math.max(abs((v) => v.revenue), Math.abs(m.cof) + Math.abs(m.kept));
  const span = Math.max(abs((v) => v.revenue) + sde, prime + Math.abs(m.demandTotal), Math.abs(m.cof) + sde + Math.abs(m.demandTotal));
  return span > 0 ? BAND / span : 0;
}

const widthAt = (k: number) => (v: number) => (Math.abs(v) < 1 ? 0 : Math.max(MIN_W, Math.abs(v) * k));

interface RowGeom {
  row: StreamRow;
  wr: number;
  ws: number;
  /** Centre of the revenue stream and of the SDE stream where it leaves. */
  yr: number;
  ys: number;
}

function layoutRows(m: StreamModel, w: (v: number) => number): { rows: RowGeom[]; bottom: number } {
  let y = TOP;
  const rows = m.venues.map((v) => {
    const wr = w(v.revenue);
    const ws = w(v.sde);
    const body = wr + (wr && ws ? SDE_GAP : 0) + ws;
    const h = Math.max(ROW_MIN, body);
    const top = y + (h - body) / 2;
    y += h + ROW_GAP;
    const row = { id: v.id, label: v.label, synthetic: v.synthetic, revenue: v.revenue, sde: v.sde, y: top + (wr || ws) / 2 };
    return { row, wr, ws, yr: top + wr / 2, ys: top + (wr ? wr + SDE_GAP : 0) + ws / 2 };
  });
  return { rows, bottom: y };
}

/** Revenue into the Prime's left edge, gains stacked first, then the
 *  losses leaving the same edge back to their venues. */
function revenueStreams(rows: RowGeom[], primeTop: number): { streams: Stream[]; left: number } {
  let acc = 0;
  const dock = (g: RowGeom) => {
    const y = primeTop + acc + g.wr / 2;
    acc += g.wr;
    return y;
  };
  const gains = rows.filter((g) => g.wr && g.row.revenue > 0);
  const losses = rows.filter((g) => g.wr && g.row.revenue < 0);
  const streams = [
    ...gains.map((g) => ({ g, ...streamPath(SRC_X, g.yr, PRIME_X, dock(g), g.wr), loss: false })),
    ...losses.map((g) => ({ g, ...streamPath(PRIME_X, dock(g), SRC_X, g.yr, g.wr), loss: true })),
  ].map(({ g, d, head, loss }) => ({ key: `rev-${g.row.id}`, kind: "revenue" as const, venue: g.row.id, value: g.row.revenue, w: g.wr, d, head, loss }));
  return { streams, left: acc };
}

/** SDE straight from its venue into Sky's in-segment, above the cost of
 *  funds — it crosses the Prime's column without docking there. */
function sdeStreams(rows: RowGeom[]): { streams: Stream[]; h: number } {
  let acc = 0;
  const streams = rows
    .filter((g) => g.ws)
    .map((g) => {
      const y = TOP + acc + g.ws / 2;
      acc += g.ws;
      const loss = g.row.sde < 0;
      const p = loss ? streamPath(SKY_X, y, SRC_X, g.ys, g.ws) : streamPath(SRC_X, g.ys, SKY_X, y, g.ws);
      return { key: `sde-${g.row.id}`, kind: "sde" as const, venue: g.row.id, value: g.row.sde, w: g.ws, ...p, loss };
    });
  return { streams, h: acc };
}

function demandLane(m: StreamModel, w: (v: number) => number, y0: number) {
  let acc = 0;
  const parts = m.demand.map((p) => {
    const h = w(p.value);
    const part = { key: p.key, y: y0 + acc, h };
    acc += h;
    return part;
  });
  const streams: Stream[] = parts.map((p, i) => {
    const y = p.y + p.h / 2;
    const value = m.demand[i].value;
    const path = value < 0 ? streamPath(PRIME_X + NODE_W, y, SKY_X, y, p.h) : streamPath(SKY_X, y, PRIME_X + NODE_W, y, p.h);
    return { key: `demand-${p.key}`, kind: "demand", series: p.key, value, w: p.h, ...path, loss: value < 0 };
  });
  return { block: acc ? { y: y0, h: acc, parts } : null, streams };
}

function primeOut(m: StreamModel, w: (v: number) => number, top: number) {
  const wc = w(m.cof);
  const wk = w(m.kept);
  const cofY = top + wc / 2;
  const keptY = top + wc + wk / 2;
  const streams: Stream[] = [];
  if (wc) streams.push({ key: "cof", kind: "cof", value: m.cof, w: wc, ...streamPath(PRIME_X + NODE_W, cofY, SKY_X, cofY, wc), loss: m.cof < 0 });
  if (wk) streams.push({ key: "kept", kind: "kept", value: m.kept, w: wk, ...streamPath(PRIME_X + NODE_W, keptY, PRIME_X + NODE_W + KEPT_STUB, keptY, wk, "stop"), loss: m.kept < 0 });
  return { streams, right: wc + wk, kept: wk ? { value: m.kept, y: keptY, w: wk } : null };
}

export function layoutStreams(m: StreamModel): StreamLayout {
  const w = widthAt(streamScale(m));
  const { rows, bottom } = layoutRows(m, w);
  const sde = sdeStreams(rows);
  const primeTop = TOP + sde.h;
  const rev = revenueStreams(rows, primeTop);
  const out = primeOut(m, w, primeTop);
  const primeH = Math.max(rev.left, out.right, 4);
  const demandTop = Math.max(primeTop + primeH, TOP + sde.h + w(m.cof) + 16) + LANE_GAP;
  const demand = demandLane(m, w, demandTop);
  const demandBottom = demand.block ? demand.block.y + demand.block.h : demandTop;
  const height = Math.max(bottom, demandBottom + 34, primeTop + primeH + 20) + 8;
  return {
    width: WIDTH,
    height,
    rows: rows.map((g) => g.row),
    streams: [...sde.streams, ...rev.streams, ...out.streams, ...demand.streams],
    prime: { x: PRIME_X, y: primeTop, h: primeH },
    kept: out.kept,
    demand: demand.block,
    sky: { inY: TOP, inH: sde.h + w(m.cof), outY: demandTop, outH: demand.block?.h ?? 0 },
  };
}
