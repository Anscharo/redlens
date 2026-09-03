// Orbital-chart geometry for the /radar MSC overview: Sky as a central
// DONUT, subdivided into one wedge per Prime by its share of the To-Sky
// total, and each Prime as a floating VERTICAL STACKED BAR (with a zero line
// through it so losses hang below) on its own circular plate orbiting Sky.
// An arrow from each plate into its own wedge carries the one ratio in this
// data that means something: the share of the Prime's production that
// month that went to Sky. Pure math, no DOM — the view just maps over
// prebuilt SVG path strings (settlementSankey.ts precedent).
//
// Three quantities, three encodings:
// - BAR: the Prime's own money — supply kept + demand-side — stacked up
//   from zero (gains) or down from it (losses). Bar HEIGHT is on a shared
//   square-root scale (the $55k Primes have to stay visible beside a $3.8M
//   one); the segments split each side proportionally, so the split is
//   still linear within the bar.
// - The DONUT: the To-Sky total (cost of funds + SDE), which is money
//   passing THROUGH the Primes, not earned by them; its wedges are the
//   Primes' shares of it, so Sky is visibly the sum of its inflows.
// - The PLATE: area ∝ the Prime's PRODUCTION (To-Sky + kept + demand) on
//   a shared scale, floored to whatever its bar and name need.
// - The ARROW: width linear in the To-Sky amount; its hover carries the
//   share, To-Sky ÷ production. A Prime that pays Sky nothing (Keel,
//   Skybase) has no arrow and no wedge.
//
// Placement: each contributing Prime sits at ITS OWN WEDGE's mid-angle, so
// its arrow runs straight in and never crosses the donut; non-contributors
// fill the biggest gaps; then a relaxation pass pushes neighbours apart
// just far enough that their plates don't touch.

import { SETTLEMENT_NEAR_ZERO } from "@/lib/settlements";
import type { PrimeFlowTotals } from "@/lib/settlementsOverview";

export const WIDTH = 840;
const CX = WIDTH / 2;
/** Orbit ellipse the bars' zero points sit on (wider than tall, like the
 *  frame). */
const ORBIT_RX = 320;
const ORBIT_RY = 200;
/** Sky donut radii. */
const SKY_R = 92;
const SKY_INNER_R = 58;
/** Bar width, and the px the tallest bar side (gains or losses) reaches. */
const BAR_W = 26;
const BAR_MAX = 100;
/** Thinnest drawable segment, so a $6k part beside a $2.8M one still exists
 *  as a hover target. */
const SEG_MIN_H = 2;
/** Zero-line overhang past the bar on each side. */
const ZERO_TICK = 8;
/** Plate padding around the bar + label box, and the smallest plate. */
const PLATE_PAD = 10;
const PLATE_MIN_R = 34;
/** The month's biggest production renders at this plate radius; a plate
 *  is never smaller than what its bar and name need, so tiny producers
 *  are floored by their contents. */
const PLATE_MAX_R = 100;
/** Minimum clearance between two plates. */
const CLEARANCE = 16;
/** Minimum gap between a plate and the donut — room for the arrow. */
const DONUT_GAP = 64;
/** ~px per character of the 13px name label. */
const CHAR_PX = 7.2;
const LABEL_GAP = 6;
/** Arrow shaft width: linear in the To-Sky amount, biggest at W_MAX. */
const W_MAX = 16;
const W_MIN = 2;
const HEAD_LEN = 12;
const HEAD_FLARE = 5;
/** Smallest Sky wedge, so a hairline contribution ($497 of $15.5M) still
 *  shows and its arrow still has a distinguishable dock point. */
const MIN_WEDGE = 0.05;
/** Keep a dock point this far (radians) inside its wedge's edges. */
const DOCK_INSET = 0.04;
/** Leader length from an arrow to its hover pill. */
const PILL_OFFSET = 30;
/** A segment pill sits this far to the side of its bar's center line. */
const PILL_DX = 96;

/** FIXED frame: the viewBox never changes with the month, so switching
 *  months can't reflow the page below the chart. */
export const HEIGHT = 2 * (SKY_R + DONUT_GAP + 2 * PLATE_MAX_R + 12);

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
  /** Where the hover pill sits — beside the plate, never over it. */
  pillX: number;
  pillY: number;
}

export interface RingArrow {
  kind: "sky";
  /** Magnitude; the sign lives in `signed` (negative → striped fill). */
  value: number;
  signed: number;
  /** To-Sky ÷ production (To-Sky + kept + demand). Null when the
   *  denominator isn't positive. */
  share: number | null;
  path: string;
  /** Where the pill's leader touches the arrow (its midpoint). */
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
  /** Mid-angle of the wedge. */
  mid: number;
  value: number;
}

export interface RingPrime {
  /** Workbook prime key ("spark"). */
  prime: string;
  /** Angle of the bar's zero point around Sky (radians, 12 o'clock = −π/2). */
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
  /** Name label, to the left of the zero line (anchor "end"). */
  labelX: number;
  labelY: number;
  /** Circular plate enclosing the bar and its label; area ∝ production. */
  plateX: number;
  plateY: number;
  plateR: number;
  /** To-Sky + kept + demand (signed) — what the plate's size stands for. */
  production: number;
  /** Where the production pill sits (above the plate) and its anchor. */
  productionPillX: number;
  productionPillY: number;
  productionAnchorX: number;
  productionAnchorY: number;
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

const TWO_PI = 2 * Math.PI;
const norm = (a: number) => ((a % TWO_PI) + TWO_PI) % TWO_PI;
/** Signed shortest angular distance from a to b. */
const angDiff = (a: number, b: number) => norm(b - a + Math.PI) - Math.PI;

/** Zero point of a bar at orbit angle t. */
function orbit(t: number, cy: number): [number, number] {
  return [CX + ORBIT_RX * Math.cos(t), cy + ORBIT_RY * Math.sin(t)];
}

const REVENUE_KINDS = ["kept", "demand"] as const;

export function layoutMscRing(
  primes: readonly PrimeFlowTotals[],
  labelOf: (prime: string) => string = (p) => p,
): RingLayout {
  const cy = HEIGHT / 2;
  const rows = primes
    .map((p) => {
      const parts = REVENUE_KINDS.map((kind) => ({ kind, signed: p[kind] })).filter(
        (f) => Math.abs(f.signed) >= SETTLEMENT_NEAR_ZERO,
      );
      const sky = Math.abs(p.sky) >= SETTLEMENT_NEAR_ZERO ? p.sky : 0;
      const gains = parts.filter((f) => f.signed > 0).reduce((n, f) => n + f.signed, 0);
      const losses = parts.filter((f) => f.signed < 0).reduce((n, f) => n - f.signed, 0);
      return { p, parts, sky, gains, losses, production: sky + gains - losses };
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

  // Bar side heights: one square-root scale for the month, pinned so the
  // tallest side of the tallest bar is BAR_MAX. Segments split a side
  // proportionally (linear within the bar).
  const maxExtent = Math.max(1, ...rows.map((r) => Math.max(r.gains, r.losses)));
  const sideH = (v: number) => BAR_MAX * Math.sqrt(v / maxExtent);
  const skyTotal = rows.reduce((n, r) => n + Math.abs(r.sky), 0);
  const maxSky = Math.max(1, ...rows.map((r) => Math.abs(r.sky)));
  const widthOf = (v: number) => Math.max(W_MIN, (W_MAX * v) / maxSky);

  // Plate area ∝ production, pinned so the month's biggest producer is
  // PLATE_MAX_R; the content floor below keeps small ones legible.
  const maxProduction = Math.max(1, ...rows.map((r) => r.production));
  const plateFor = (production: number) => PLATE_MAX_R * Math.sqrt(Math.max(0, production) / maxProduction);

  // Angle-independent geometry first: each bar's extent above/below its zero
  // line, its label width, and the plate that has to enclose both.
  const shape = rows.map((r) => {
    const up = r.gains > 0 ? sideH(r.gains) : 0;
    const down = r.losses > 0 ? sideH(r.losses) : 0;
    const labelW = labelOf(r.p.prime).length * CHAR_PX;
    // Box: label | gap | zero-line overhang | bar | overhang, by the bar's
    // vertical extent (at least the zero line's own little cross).
    const left = -(BAR_W / 2 + ZERO_TICK + LABEL_GAP + labelW);
    const right = BAR_W / 2 + ZERO_TICK;
    const top = -Math.max(up, 8);
    const bottom = Math.max(down, 8);
    const plateDx = (left + right) / 2;
    const plateDy = (top + bottom) / 2;
    const contentR = Math.hypot((right - left) / 2, (bottom - top) / 2) + PLATE_PAD;
    const plateR = Math.max(PLATE_MIN_R, contentR, plateFor(r.production));
    return { up, down, plateDx, plateDy, plateR };
  });

  // Sky's wedges in row order (magnitude-desc), rotated so the biggest
  // contributor's wedge is centered at 12 o'clock.
  const contributors = rows.map((r, i) => ({ r, i })).filter((x) => x.r.sky !== 0);
  const floorShare = MIN_WEDGE / TWO_PI;
  const shares = contributors.map((x) => Math.max(Math.abs(x.r.sky) / (skyTotal || 1), floorShare));
  const shareSum = shares.reduce((n, s) => n + s, 0) || 1;
  const spans = shares.map((s) => (s / shareSum) * TWO_PI);
  let wa = -Math.PI / 2 - (spans[0] ?? 0) / 2;
  const wedgeRange = new Map<string, [number, number]>();
  const skyWedges: RingSkyWedge[] = contributors.map((x, j) => {
    const a0 = wa;
    const a1 = wa + spans[j];
    wa = a1;
    wedgeRange.set(x.r.p.prime, [a0, a1]);
    return {
      prime: x.r.p.prime,
      path: annulusPath(CX, cy, SKY_R, SKY_INNER_R, a0, a1),
      mid: (a0 + a1) / 2,
      value: Math.abs(x.r.sky),
    };
  });

  // Target angles: a contributor sits at its own wedge's middle; the rest
  // take the middle of the widest remaining gap, one after another.
  const angles: number[] = new Array(rows.length).fill(NaN);
  for (const w of skyWedges) angles[rows.findIndex((r) => r.p.prime === w.prime)] = norm(w.mid);
  for (let i = 0; i < rows.length; i++) {
    if (!Number.isNaN(angles[i])) continue;
    const placed = angles.filter((a) => !Number.isNaN(a)).sort((a, b) => a - b);
    if (placed.length === 0) {
      angles[i] = norm(-Math.PI / 2);
      continue;
    }
    let best = 0;
    let bestGap = -1;
    for (let k = 0; k < placed.length; k++) {
      const a = placed[k];
      const b = k + 1 < placed.length ? placed[k + 1] : placed[0] + TWO_PI;
      if (b - a > bestGap) {
        bestGap = b - a;
        best = (a + b) / 2;
      }
    }
    angles[i] = norm(best);
  }

  // Where prime i's zero point and plate land at orbit angle t. The plate
  // is offset from the zero point (gains pull it up, a long name pulls it
  // left), so a plate can lean into the donut even though its zero point
  // is on the orbit — when it would, the whole prime is pushed straight
  // out from Sky until the plate clears.
  const placed = (i: number, t: number) => {
    let [bx, zy] = orbit(t, cy);
    let plateX = bx + shape[i].plateDx;
    let plateY = zy + shape[i].plateDy;
    const d = Math.hypot(plateX - CX, plateY - cy) || 1;
    const need = SKY_R + shape[i].plateR + DONUT_GAP;
    if (d < need) {
      const ux = (plateX - CX) / d;
      const uy = (plateY - cy) / d;
      bx += ux * (need - d);
      zy += uy * (need - d);
      plateX += ux * (need - d);
      plateY += uy * (need - d);
    }
    return { bx, zy, plateX, plateY };
  };
  const plateAt = (i: number, t: number): [number, number] => {
    const p = placed(i, t);
    return [p.plateX, p.plateY];
  };

  // Relaxation: push orbital neighbours apart until their plates clear each
  // other, measured between the actual plate centers.
  const order = rows.map((_, i) => i);
  for (let pass = 0; pass < 24; pass++) {
    order.sort((a, b) => angles[a] - angles[b]);
    let moved = false;
    for (let k = 0; k < order.length && order.length > 1; k++) {
      const i = order[k];
      const j = order[(k + 1) % order.length];
      if (i === j) continue;
      const [xi, yi] = plateAt(i, angles[i]);
      const [xj, yj] = plateAt(j, angles[j]);
      const d = Math.hypot(xi - xj, yi - yj);
      const need = shape[i].plateR + shape[j].plateR + CLEARANCE;
      if (d >= need) continue;
      // Local px-per-radian along the orbit at each end.
      const speed = (t: number) => Math.hypot(ORBIT_RX * Math.sin(t), ORBIT_RY * Math.cos(t));
      const dTheta = (need - d) / ((speed(angles[i]) + speed(angles[j])) / 2 || 1);
      angles[i] = norm(angles[i] - dTheta / 2);
      angles[j] = norm(angles[j] + dTheta / 2);
      moved = true;
    }
    if (!moved) break;
  }

  const out: RingPrime[] = rows.map((r, i) => {
    const t = angles[i];
    const { bx, zy, plateX, plateY } = placed(i, t);
    const s = shape[i];
    // Pills go to the side of the plate that faces away from Sky.
    const side = plateX < CX - 1 ? -1 : 1;

    const segments: RingSegment[] = [];
    let up = 0;
    let down = 0;
    for (const f of r.parts) {
      const share = f.signed > 0 ? f.signed / r.gains : -f.signed / r.losses;
      const h = Math.max(SEG_MIN_H, (f.signed > 0 ? s.up : s.down) * share);
      let y: number;
      if (f.signed > 0) {
        y = zy - up - h;
        up += h;
      } else {
        y = zy + down;
        down += h;
      }
      const amountY = y + h / 2;
      segments.push({
        kind: f.kind,
        signed: f.signed,
        x: bx - BAR_W / 2,
        y,
        w: BAR_W,
        h,
        amountX: bx,
        amountY,
        pillX: plateX + side * (s.plateR + PILL_DX - 40),
        pillY: amountY,
      });
    }

    // The arrow leaves the plate's edge toward the nearest point of this
    // prime's own wedge (its middle when the plate sits straight out from
    // it) and ends on the donut's outer edge — so it never has to cross
    // the donut to get there.
    let arrow: RingArrow | null = null;
    const range = wedgeRange.get(r.p.prime);
    if (r.sky !== 0 && range) {
      const [a0, a1] = range;
      const toward = Math.atan2(plateY - cy, plateX - CX);
      const mid = (a0 + a1) / 2;
      const half = Math.max(0, (a1 - a0) / 2 - DOCK_INSET);
      const dock = mid + Math.max(-half, Math.min(half, angDiff(mid, toward)));
      const x1 = CX + SKY_R * Math.cos(dock);
      const y1 = cy + SKY_R * Math.sin(dock);
      const dx = x1 - plateX;
      const dy = y1 - plateY;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const x0 = plateX + ux * (s.plateR + 2);
      const y0 = plateY + uy * (s.plateR + 2);
      const amountX = (x0 + x1) / 2;
      const amountY = (y0 + y1) / 2;
      arrow = {
        kind: "sky",
        value: Math.abs(r.sky),
        signed: r.sky,
        share: r.production >= SETTLEMENT_NEAR_ZERO ? r.sky / r.production : null,
        path: arrowPath(x0, y0, x1, y1, widthOf(Math.abs(r.sky))),
        amountX,
        amountY,
        // Off to the side of the arrow (perpendicular), never on top of it.
        pillX: amountX - uy * PILL_OFFSET,
        pillY: amountY + ux * PILL_OFFSET,
      };
    }

    return {
      prime: r.p.prime,
      angle: t,
      cx: bx,
      zeroY: zy,
      barW: BAR_W,
      zeroX0: bx - BAR_W / 2 - ZERO_TICK,
      zeroX1: bx + BAR_W / 2 + ZERO_TICK,
      segments,
      arrow,
      labelX: bx - BAR_W / 2 - ZERO_TICK - LABEL_GAP,
      labelY: zy,
      plateX,
      plateY,
      plateR: s.plateR,
      production: r.production,
      productionPillX: plateX,
      // Above the plate, unless that would leave the frame (the 12 o'clock
      // plate), then below it — the donut gap has room for a pill.
      productionPillY: plateY - s.plateR - 18 >= 12 ? plateY - s.plateR - 18 : plateY + s.plateR + 18,
      productionAnchorX: plateX,
      productionAnchorY: plateY - s.plateR - 18 >= 12 ? plateY - s.plateR + 1 : plateY + s.plateR - 1,
    };
  });

  return { ...empty, skyWedges, primes: out };
}
