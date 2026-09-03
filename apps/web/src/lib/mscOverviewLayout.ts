// Orbital-chart geometry for the /radar MSC overview: Sky as a central
// DONUT, subdivided into one wedge per Prime by its share of the To-Sky
// total, and each Prime as a floating VERTICAL STACKED BAR (with a zero line
// through it so losses hang below) on its own circular plate orbiting Sky.
// An arrow from each plate into its own wedge carries the one ratio in this
// data that means something: the share of the Prime's gross revenue that
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
// - The PLATE: area ∝ the Prime's GROSS REVENUE (To-Sky + kept + demand,
//   i.e. everything its book generated before cost of funds — the
//   workbook's prime_agent_total_revenue plus Sky Direct Exposure) on a
//   shared scale, floored to whatever its bar and name need.
// - The ARROW: width linear in the To-Sky amount; its hover lists the two
//   components — cost of funds (interest the Prime owes Sky) and Sky
//   Direct Exposure (Sky's own income passing through the Prime's venues)
//   — then the total and the share, To-Sky ÷ gross revenue. A Prime that
//   pays Sky nothing (Keel, Skybase) has no arrow and no wedge.
//
// Placement: Primes go clockwise from 12 o'clock in the order given (the
// caller passes PRIME_ORDER), EVENLY spaced around Sky; a relaxation pass
// then pushes neighbours apart only where their plates would still touch.
// Wedges are laid out in that same order, so a Prime's own wedge is always
// on its side of the donut, and its arrow docks at the nearest point of
// that wedge — straight in when the wedge is under it, a slight lean when
// the wedge is wider or narrower than the Prime's even slot.

import { SETTLEMENT_NEAR_ZERO } from "@/lib/settlements";
import type { PrimeFlowTotals } from "@/lib/settlementsOverview";

export const WIDTH = 1300;
const CX = WIDTH / 2;
/** Orbit ellipse the bars' zero points sit on — a lower bound; a plate
 *  that would lean into the donut is pushed further out. */
const ORBIT_RX = 500;
const ORBIT_RY = 330;
/** Sky donut: on the SAME area scale as the plates (see R_MAX), with a
 *  floor so the label always fits; the hole is a fixed fraction of it. */
const SKY_MIN_R = 80;
const SKY_HOLE = 0.62;
/** Bar width, and the px the tallest bar side (gains or losses) reaches. */
const BAR_W = 36;
const BAR_MAX = 140;
/** Thinnest drawable segment, so a $6k part beside a $2.8M one still exists
 *  as a hover target. */
const SEG_MIN_H = 3;
/** Zero-line overhang past the bar on each side. */
const ZERO_TICK = 10;
/** Plate padding around the bar (+ label) box, and the smallest plate. */
const PLATE_PAD = 12;
const PLATE_MIN_R = 40;
/** ONE area scale for the donut and every plate: the month's biggest
 *  amount (the To-Sky total, or a Prime's gross revenue) renders at this
 *  radius. The data scale is deliberately LARGE against the fixed-size
 *  chrome (bars, names, pills), so the content floors below bind only on
 *  the tiniest Primes. */
const R_MAX = 160;
/** Minimum clearance between two plates (including an outside name). */
const CLEARANCE = 22;
/** Minimum gap between a plate and the donut — room for the arrow. */
const DONUT_GAP = 84;
/** ~px per character of the 17px name label. */
const CHAR_PX = 9.5;
const LABEL_GAP = 8;
/** Vertical room reserved for a name drawn outside its plate. */
const LABEL_OUT = 24;
/** Arrow shaft width: linear in the To-Sky amount, biggest at W_MAX. */
const W_MAX = 22;
const W_MIN = 3;
const HEAD_LEN = 16;
const HEAD_FLARE = 7;
/** Smallest Sky wedge, so a hairline contribution ($497 of $15.5M) still
 *  shows and its arrow still has a distinguishable dock point. */
const MIN_WEDGE = 0.05;
/** Keep a dock point this far (radians) inside its wedge's edges. */
const DOCK_INSET = 0.04;
/** How far (radians) a Prime may sit from its own wedge before its slot is
 *  pulled toward it — beyond this the arrow would cross the donut. */
const MAX_LEAN = Math.PI / 3;
/** Leader length from an arrow to its hover pill. */
const PILL_OFFSET = 40;
/** A segment pill sits this far to the side of its bar's center line. */
const PILL_DX = 130;

/** FIXED frame: the viewBox never changes with the month, so switching
 *  months can't reflow the page below the chart. Budget: the donut, the
 *  gap, and a plate up to 0.85·R_MAX with its name outside, top and bottom. */
export const HEIGHT = 2 * (R_MAX + DONUT_GAP + 1.7 * R_MAX + LABEL_OUT + 24);

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
  /** Magnitude of the whole arrow (cof + sde); sign in `signed`. */
  value: number;
  signed: number;
  /** Its two components (signed). */
  cof: number;
  sde: number;
  /** To-Sky ÷ gross revenue (To-Sky + kept + demand). Null when the
   *  denominator isn't positive. */
  share: number | null;
  /** Angle (radians) where the tip meets the donut — inside its own wedge. */
  dock: number;
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
  /** Angular extent (radians) and its middle. */
  a0: number;
  a1: number;
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
  /** Name label: "inside" sits to the left of the zero line (anchor
   *  "end"); "outside" is centered above/below the plate (anchor "middle")
   *  — for a Prime too small to hold its own name. */
  labelMode: "inside" | "outside";
  labelAnchor: "end" | "middle";
  labelX: number;
  labelY: number;
  /** Circular plate enclosing the bar and its label; area ∝ gross revenue. */
  plateX: number;
  plateY: number;
  plateR: number;
  /** Gross revenue: To-Sky + kept + demand (signed) — what the plate's
   *  size stands for. */
  gross: number;
  /** Where the gross-revenue pill sits (above the plate) and its anchor. */
  grossPillX: number;
  grossPillY: number;
  grossAnchorX: number;
  grossAnchorY: number;
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
      return { p, parts, sky, gains, losses, gross: sky + gains - losses };
    })
    .filter((r) => r.parts.length > 0 || r.sky !== 0);

  const empty: RingLayout = {
    width: WIDTH,
    height: HEIGHT,
    cx: CX,
    cy,
    skyR: SKY_MIN_R,
    skyInnerR: SKY_MIN_R * SKY_HOLE,
    skyWedges: [],
    primes: [],
  };
  if (rows.length === 0) return empty;

  // Bar side heights: one square-root scale for the month, pinned so the
  // tallest side of the tallest bar is BAR_MAX. Segments split a side
  // proportionally (linear within the bar).
  const maxExtent = Math.max(1, ...rows.map((r) => Math.max(r.gains, r.losses)));
  const sideH = (v: number) => BAR_MAX * Math.sqrt(v / maxExtent);
  const maxSky = Math.max(1, ...rows.map((r) => Math.abs(r.sky)));
  const widthOf = (v: number) => Math.max(W_MIN, (W_MAX * v) / maxSky);

  // Area ∝ dollars on one scale shared by the donut and the plates, pinned
  // so the month's biggest amount is R_MAX — so a $16M To-Sky donut reads
  // bigger than an $11M Prime, and vice versa. Content floors keep the
  // small ones legible.
  const skyTotal = rows.reduce((n, r) => n + Math.abs(r.sky), 0);
  const ref = Math.max(1, skyTotal, ...rows.map((r) => r.gross));
  const radiusFor = (v: number) => R_MAX * Math.sqrt(Math.max(0, v) / ref);
  const skyR = Math.max(SKY_MIN_R, radiusFor(skyTotal));
  const skyInnerR = skyR * SKY_HOLE;

  // Angle-independent geometry first: each bar's extent above/below its zero
  // line, its label width, and the plate. The name goes INSIDE (left of the
  // zero line) when the data-sized plate can hold bar + name; otherwise the
  // plate holds just the bar and the name sits outside it, so the tiniest
  // Primes stay data-sized instead of being inflated to fit a word.
  const shape = rows.map((r) => {
    const up = r.gains > 0 ? sideH(r.gains) : 0;
    const down = r.losses > 0 ? sideH(r.losses) : 0;
    const labelW = labelOf(r.p.prime).length * CHAR_PX;
    const right = BAR_W / 2 + ZERO_TICK;
    const top = -Math.max(up, 8);
    const bottom = Math.max(down, 8);
    const halfH = (bottom - top) / 2;
    // Box with the name: label | gap | zero-line overhang | bar | overhang.
    const leftIn = -(right + LABEL_GAP + labelW);
    const withLabelR = Math.hypot((right - leftIn) / 2, halfH) + PLATE_PAD;
    const bareR = Math.hypot(right, halfH) + PLATE_PAD;
    const dataR = radiusFor(r.gross);
    const outside = dataR < withLabelR;
    const plateR = Math.max(PLATE_MIN_R, outside ? bareR : withLabelR, dataR);
    const plateDx = outside ? 0 : (leftIn + right) / 2;
    const plateDy = (top + bottom) / 2;
    // Footprint used for spacing: the plate plus an outside name's room.
    const spaceR = plateR + (outside ? LABEL_OUT : 0);
    return { up, down, plateDx, plateDy, plateR, spaceR, outside };
  });

  // Sky's wedges in row order (the caller's PRIME_ORDER), rotated so the
  // first contributor's wedge is centered at 12 o'clock.
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
      path: annulusPath(CX, cy, skyR, skyInnerR, a0, a1),
      a0,
      a1,
      mid: (a0 + a1) / 2,
      value: Math.abs(x.r.sky),
    };
  });

  // Target angles: even slots clockwise from 12 o'clock, in row order. A
  // contributor whose slot is more than MAX_LEAN from its own wedge is
  // pulled to MAX_LEAN of the wedge's nearest edge, so its arrow can still
  // reach the wedge without cutting across the donut. The relaxation below
  // then moves Primes off their slots only where plates collide.
  const angles: number[] = rows.map((_, i) => norm(-Math.PI / 2 + (i * TWO_PI) / rows.length));
  for (const [i, r] of rows.entries()) {
    const range = wedgeRange.get(r.p.prime);
    if (!range) continue;
    const [a0, a1] = range;
    const mid = (a0 + a1) / 2;
    const half = (a1 - a0) / 2;
    const off = angDiff(mid, angles[i]);
    if (Math.abs(off) > half + MAX_LEAN) angles[i] = norm(mid + Math.sign(off) * (half + MAX_LEAN));
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
    const need = skyR + shape[i].spaceR + DONUT_GAP;
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
      const need = shape[i].spaceR + shape[j].spaceR + CLEARANCE;
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
      const x1 = CX + skyR * Math.cos(dock);
      const y1 = cy + skyR * Math.sin(dock);
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
        cof: r.p.cof,
        sde: r.p.sde,
        share: r.gross >= SETTLEMENT_NEAR_ZERO ? r.sky / r.gross : null,
        dock,
        path: arrowPath(x0, y0, x1, y1, widthOf(Math.abs(r.sky))),
        amountX,
        amountY,
        // Off to the side of the arrow (perpendicular), never on top of it.
        pillX: amountX - uy * PILL_OFFSET,
        pillY: amountY + ux * PILL_OFFSET,
      };
    }

    const labelAbove = plateY <= cy;
    const pillAbove = plateY - s.plateR - 34 >= 0 && !(s.outside && labelAbove);
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
      labelMode: s.outside ? ("outside" as const) : ("inside" as const),
      labelAnchor: s.outside ? ("middle" as const) : ("end" as const),
      labelX: s.outside ? plateX : bx - BAR_W / 2 - ZERO_TICK - LABEL_GAP,
      // An outside name goes on the side AWAY from Sky (above for the upper
      // half, below for the lower), so it never sits in the arrow's way.
      labelY: s.outside ? (labelAbove ? plateY - s.plateR - 12 : plateY + s.plateR + 18) : zy,
      plateX,
      plateY,
      plateR: s.plateR,
      gross: r.gross,
      grossPillX: plateX,
      // Above the plate, unless that would leave the frame (the 12 o'clock
      // plate) or collide with an outside name — then below it; the donut
      // gap has room for a pill.
      grossPillY: pillAbove ? plateY - s.plateR - 22 : plateY + s.plateR + 22,
      grossAnchorX: plateX,
      grossAnchorY: pillAbove ? plateY - s.plateR + 1 : plateY + s.plateR - 1,
    };
  });

  return { ...empty, skyR, skyInnerR, skyWedges, primes: out };
}
