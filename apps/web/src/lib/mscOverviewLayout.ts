// Orbital-chart geometry for the /radar MSC overview: Sky as a central
// DONUT, subdivided into one wedge per Prime by its share of the To-Sky
// total, and each Prime as a floating VERTICAL STACKED BAR orbiting it, with
// a zero line through it so losses hang below. An arrow from each bar into
// its own wedge carries the one ratio in this data that means something:
// the share of what the Prime produced that month that went to Sky.
// Pure math, no DOM — the view just maps over prebuilt SVG path strings
// (settlementSankey.ts precedent).
//
// Three quantities, three encodings:
// - BAR segments: the Prime's own money — supply kept + demand-side —
//   stacked up from zero (gains) or down from it (losses), on ONE linear
//   px-per-dollar scale shared by every bar in the month.
// - The DONUT: the To-Sky total (cost of funds + SDE), which is money
//   passing THROUGH the Primes, not earned by them; its wedges are the
//   Primes' shares of it, so Sky is visibly the sum of its inflows.
// - The ARROW: width linear in the To-Sky amount, label = To-Sky ÷ (To-Sky
//   + kept + demand). A Prime that pays Sky nothing (Keel, Skybase) has no
//   arrow and no wedge.

import { SETTLEMENT_NEAR_ZERO } from "@/lib/settlements";
import type { PrimeFlowTotals } from "@/lib/settlementsOverview";

export const WIDTH = 840;
const CX = WIDTH / 2;
/** Orbit ellipse the bars' zero points sit on (wider than tall, like the
 *  frame). */
const ORBIT_RX = 300;
const ORBIT_RY = 165;
/** Sky donut radii. */
const SKY_R = 92;
const SKY_INNER_R = 58;
/** Bar width, and the px the tallest bar side (gains or losses) reaches. */
const BAR_W = 28;
const BAR_MAX = 100;
/** Thinnest drawable segment, so a $6k part beside a $2.8M one still exists
 *  as a hover target. */
const SEG_MIN_H = 2;
/** Zero-line overhang past the bar on each side. */
const ZERO_TICK = 8;
/** Arrow shaft width: linear in the To-Sky amount, biggest at W_MAX. */
const W_MAX = 16;
const W_MIN = 2;
const HEAD_LEN = 12;
const HEAD_FLARE = 5;
/** Smallest Sky wedge, so a hairline contribution ($497 of $15.5M) still
 *  shows and its arrow still has a distinguishable dock point. */
const MIN_WEDGE = 0.05;
/** Leader length from an arrow to its hover pill. */
const PILL_OFFSET = 30;
/** A segment pill sits this far to the side of its bar's center line. */
const PILL_DX = 90;
/** Name label gap under the bar's lowest extent. */
const LABEL_GAP = 17;

/** FIXED frame: the viewBox never changes with the month, so switching
 *  months can't reflow the page below the chart. */
export const HEIGHT = 2 * (ORBIT_RY + BAR_MAX + 44);

export interface RingSegment {
  kind: "kept" | "demand";
  /** Signed value; negative segments hang below the zero line (striped). */
  signed: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Where the pill's leader touches the segment (its center). */
  amountX: number;
  amountY: number;
  /** Where the hover pill sits — beside the bar, never over it. */
  pillX: number;
  pillY: number;
}

export interface RingArrow {
  kind: "sky";
  /** Magnitude; the sign lives in `signed` (negative → striped fill). */
  value: number;
  signed: number;
  /** To-Sky ÷ (To-Sky + kept + demand) — what fraction of the Prime's month
   *  went to Sky. Null when the denominator isn't positive. */
  share: number | null;
  path: string;
  /** Always-visible share badge, on the arrow's midpoint. */
  labelX: number;
  labelY: number;
  /** Where the pill's leader touches the arrow (nearer the Sky end, so the
   *  leader never crosses the badge). */
  amountX: number;
  amountY: number;
  pillX: number;
  pillY: number;
}

/** One prime's share of the Sky donut. The wedges together ARE the donut,
 *  which is the point: every dollar in it arrived from a prime. */
export interface RingSkyWedge {
  prime: string;
  path: string;
  /** Mid-angle of the wedge — where that prime's arrow docks. */
  mid: number;
  value: number;
}

export interface RingPrime {
  /** Workbook prime key ("spark"). */
  prime: string;
  /** Parametric angle around Sky (radians, 12 o'clock = −π/2). */
  angle: number;
  /** Bar center line and zero line. */
  cx: number;
  zeroY: number;
  barW: number;
  /** Zero line extent (overhangs the bar). */
  zeroX0: number;
  zeroX1: number;
  /** Stacked segments: gains above the zero line, losses below. */
  segments: RingSegment[];
  /** The To-Sky arrow, or null for a prime that pays Sky nothing. */
  arrow: RingArrow | null;
  /** Name label under the bar. */
  labelX: number;
  labelY: number;
}

export interface RingLayout {
  width: number;
  height: number;
  cx: number;
  cy: number;
  skyR: number;
  skyInnerR: number;
  /** Per-prime shares of the Sky donut, in orbital order. */
  skyWedges: RingSkyWedge[];
  primes: RingPrime[];
}

/** Annular sector from a0 to a1 (the whole ring when it is the only wedge;
 *  render with fill-rule evenodd). */
function annulusPath(cx: number, cy: number, rOut: number, rIn: number, a0: number, a1: number): string {
  if (a1 - a0 >= 2 * Math.PI - 1e-6) {
    const ring = (r: number) =>
      `M${cx + r},${cy} A${r},${r} 0 1 1 ${cx - r},${cy} A${r},${r} 0 1 1 ${cx + r},${cy} Z`;
    return `${ring(rOut)} ${ring(rIn)}`;
  }
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const pt = (r: number, a: number) => `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
  return (
    `M${pt(rOut, a0)} A${rOut},${rOut} 0 ${large} 1 ${pt(rOut, a1)} ` +
    `L${pt(rIn, a1)} A${rIn},${rIn} 0 ${large} 0 ${pt(rIn, a0)} Z`
  );
}

/** Filled arrow of shaft width w from (x0,y0) to a tip at (x1,y1). */
function arrowPath(x0: number, y0: number, x1: number, y1: number, w: number): string {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const hl = Math.min(HEAD_LEN, len / 2);
  const bx = x1 - ux * hl;
  const by = y1 - uy * hl;
  const s = w / 2;
  const f = s + HEAD_FLARE;
  return (
    `M${x0 + nx * s},${y0 + ny * s} L${bx + nx * s},${by + ny * s} L${bx + nx * f},${by + ny * f} ` +
    `L${x1},${y1} L${bx - nx * f},${by - ny * f} L${bx - nx * s},${by - ny * s} L${x0 - nx * s},${y0 - ny * s} Z`
  );
}

const REVENUE_KINDS = ["kept", "demand"] as const;

export function layoutMscRing(primes: readonly PrimeFlowTotals[]): RingLayout {
  const cy = HEIGHT / 2;
  const rows = primes
    .map((p) => {
      const parts = REVENUE_KINDS.map((kind) => ({ kind, signed: p[kind] })).filter(
        (f) => Math.abs(f.signed) >= SETTLEMENT_NEAR_ZERO,
      );
      const sky = Math.abs(p.sky) >= SETTLEMENT_NEAR_ZERO ? p.sky : 0;
      const gains = parts.filter((f) => f.signed > 0).reduce((n, f) => n + f.signed, 0);
      const losses = parts.filter((f) => f.signed < 0).reduce((n, f) => n - f.signed, 0);
      return { p, parts, sky, gains, losses };
    })
    .filter((r) => r.parts.length > 0 || r.sky !== 0);

  const empty: RingLayout = {
    width: WIDTH,
    height: HEIGHT,
    cx: CX,
    cy,
    skyR: SKY_R,
    skyInnerR: SKY_INNER_R,
    skyWedges: [],
    primes: [],
  };
  if (rows.length === 0) return empty;

  // One linear px-per-dollar scale for every bar in the month, pinned so
  // the tallest side (gains or losses) of the tallest bar is BAR_MAX.
  const maxExtent = Math.max(1, ...rows.map((r) => Math.max(r.gains, r.losses)));
  const px = (v: number) => (v / maxExtent) * BAR_MAX;
  const skyTotal = rows.reduce((n, r) => n + Math.abs(r.sky), 0);
  const maxSky = Math.max(1, ...rows.map((r) => Math.abs(r.sky)));
  const widthOf = (v: number) => Math.max(W_MIN, (W_MAX * v) / maxSky);

  // Even angular spacing from 12 o'clock, zero points on the orbit ellipse.
  const angles = rows.map((_, i) => -Math.PI / 2 + (i * 2 * Math.PI) / rows.length);
  const barX = angles.map((t) => CX + ORBIT_RX * Math.cos(t));
  const zeroY = angles.map((t) => cy + ORBIT_RY * Math.sin(t));

  // Sky's wedges: each contributing prime's share of the To-Sky total, laid
  // out in orbital order so arrows stay roughly radial, and anchored on the
  // BIGGEST contributor (rows are magnitude-desc) so its arrow runs straight
  // in. Together the wedges are the whole donut.
  const contributors = rows.map((r, i) => ({ r, i })).filter((x) => x.r.sky !== 0);
  const floorShare = MIN_WEDGE / (2 * Math.PI);
  const shares = contributors.map((x) => Math.max(Math.abs(x.r.sky) / (skyTotal || 1), floorShare));
  const shareSum = shares.reduce((n, s) => n + s, 0) || 1;
  const spans = shares.map((s) => (s / shareSum) * 2 * Math.PI);
  let wa = contributors.length > 0 ? angles[contributors[0].i] - spans[0] / 2 : -Math.PI / 2;
  const skyWedges: RingSkyWedge[] = contributors.map((x, j) => {
    const a0 = wa;
    const a1 = wa + spans[j];
    wa = a1;
    return {
      prime: x.r.p.prime,
      path: annulusPath(CX, cy, SKY_R, SKY_INNER_R, a0, a1),
      mid: (a0 + a1) / 2,
      value: Math.abs(x.r.sky),
    };
  });
  const dockOf = new Map(skyWedges.map((w) => [w.prime, w.mid]));

  const out: RingPrime[] = rows.map((r, i) => {
    const bx = barX[i];
    const zy = zeroY[i];
    // Pills go to the side of the bar that faces away from Sky.
    const side = bx < CX - 1 ? -1 : 1;

    // Gains stack upward from the zero line, losses downward, each in the
    // fixed kept-then-demand order so colors read the same on every bar.
    const segments: RingSegment[] = [];
    let up = 0;
    let down = 0;
    for (const f of r.parts) {
      const h = Math.max(SEG_MIN_H, px(Math.abs(f.signed)));
      let y: number;
      if (f.signed > 0) {
        y = zy - up - h;
        up += h;
      } else {
        y = zy + down;
        down += h;
      }
      const amountX = bx;
      const amountY = y + h / 2;
      segments.push({
        kind: f.kind,
        signed: f.signed,
        x: bx - BAR_W / 2,
        y,
        w: BAR_W,
        h,
        amountX,
        amountY,
        pillX: bx + side * PILL_DX,
        pillY: amountY,
      });
    }
    const top = zy - up;
    const bottom = zy + down;

    // The arrow leaves the bar's body (from its center, exiting the bar's
    // bounding box toward Sky) and ends on the donut's outer edge, at the
    // middle of this prime's own wedge.
    let arrow: RingArrow | null = null;
    const dock = dockOf.get(r.p.prime);
    if (r.sky !== 0 && dock != null) {
      const x1 = CX + SKY_R * Math.cos(dock);
      const y1 = cy + SKY_R * Math.sin(dock);
      const mx = bx;
      const my = (top + bottom) / 2;
      const dx = x1 - mx;
      const dy = y1 - my;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const halfW = BAR_W / 2 + 3;
      const halfH = (bottom - top) / 2 + 3;
      const exit = Math.min(
        Math.abs(ux) > 1e-6 ? halfW / Math.abs(ux) : Infinity,
        Math.abs(uy) > 1e-6 ? halfH / Math.abs(uy) : Infinity,
      );
      const x0 = mx + ux * exit;
      const y0 = my + uy * exit;
      const produced = r.sky + r.gains - r.losses;
      const amountX = x0 + (x1 - x0) * 0.72;
      const amountY = y0 + (y1 - y0) * 0.72;
      arrow = {
        kind: "sky",
        value: Math.abs(r.sky),
        signed: r.sky,
        share: produced >= SETTLEMENT_NEAR_ZERO ? r.sky / produced : null,
        path: arrowPath(x0, y0, x1, y1, widthOf(Math.abs(r.sky))),
        labelX: (x0 + x1) / 2,
        labelY: (y0 + y1) / 2,
        amountX,
        amountY,
        // Off to the side of the arrow (perpendicular), never on top of it.
        pillX: amountX - uy * PILL_OFFSET,
        pillY: amountY + ux * PILL_OFFSET,
      };
    }

    return {
      prime: r.p.prime,
      angle: angles[i],
      cx: bx,
      zeroY: zy,
      barW: BAR_W,
      zeroX0: bx - BAR_W / 2 - ZERO_TICK,
      zeroX1: bx + BAR_W / 2 + ZERO_TICK,
      segments,
      arrow,
      labelX: bx,
      labelY: bottom + LABEL_GAP,
    };
  });

  return { ...empty, skyWedges, primes: out };
}
