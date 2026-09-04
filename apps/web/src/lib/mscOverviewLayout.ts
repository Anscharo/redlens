// Orbital-chart geometry for the /radar MSC overview: Sky as a central
// PIE, subdivided into one wedge per Prime by its share of the To-Sky
// total, and each Prime as a PIE of its gross-revenue line items orbiting
// it, with an arrow from the pie's To-Sky slices into its own wedge. (Sky
// is a full pie, not a donut: on this chart a hole means a loss.)
// Pure math, no DOM — the view just maps over prebuilt SVG path strings
// (settlementSankey.ts precedent).
//
// ONE area scale for everything: the month's biggest amount (the To-Sky
// total, or a Prime's positive line items) renders at R_MAX, and every
// other circle's area is proportional on the same scale.
//
// A PRIME'S PIE is the highest-fidelity split the workbook Summary gives:
//   to Sky:      cost of funds, Sky Direct Exposure
//   kept:        supply kept (prime agent revenue − cost of funds)
//   demand-side: agent rate, distribution rewards, accessibility rewards,
//                Chronicle points
// Positive items are the slices; the pie's AREA is their sum. A negative
// item (a supply LOSS — Grove in 3 of 7 months) is a HOLE in the middle
// whose area is the loss, so the visible ring area is exactly gross
// revenue (= To Sky + supply kept + demand-side). The To-Sky slices face
// Sky and the arrow leaves from them.
//
// Placement: Primes go clockwise from 12 o'clock in the order given (the
// caller passes PRIME_ORDER), each given an angular slot proportional to
// its footprint — big pies get room, small ones sit close to their
// neighbours; a relaxation pass then pushes neighbours apart only where
// pies would still touch. Wedges are laid out in that same order, so a
// Prime's own wedge is always on its side of Sky, and its arrow docks at
// the nearest point of that wedge, never closer than DOCK_INSET of the
// wedge's span to either edge.

import { DEMAND_SERIES, SETTLEMENT_NEAR_ZERO, type DemandKey } from "@/lib/settlements";
import type { PrimeFlowTotals } from "@/lib/settlementsOverview";

/** Working canvas the layout is computed on. The viewBox the chart ships
 *  is then CROPPED to what got drawn (see `fitViewBox`), so the frame is
 *  never taller than its content and the card's height sets the scale. */
export const WIDTH = 1300;
const CX = WIDTH / 2;
/** Orbit circle the pie centers start on — a lower bound; a pie that would
 *  lean into Sky is pushed further out. Round, so no direction is favoured. */
const ORBIT_RX = 380;
const ORBIT_RY = 380;
/** Sky pie: on the SAME area scale as the pies (see R_MAX), with a floor
 *  so the label always fits. No hole — a hole means a loss here. */
const SKY_MIN_R = 80;
/** ONE area scale for the donut and every pie: the month's biggest
 *  amount renders at this radius. */
const R_MAX = 160;
/** Smallest pie, so a $13k Prime is still a visible, hoverable disc. */
const PIE_MIN_R = 22;
/** A loss hole is never smaller than this (a hairline hole reads as a
 *  rendering glitch) nor closer than HOLE_RIM to the pie's edge. */
const HOLE_MIN_R = 6;
const HOLE_RIM = 6;
/** Minimum clearance between two pies (including their names). */
const CLEARANCE = 22;
/** Minimum gap between a pie and the donut — room for the arrow. */
const DONUT_GAP = 84;
/** Room reserved outside a pie for its name and gross figure (two lines). */
const LABEL_OUT = 40;
/** Padding around the cropped viewBox. */
const CROP_PAD = 24;
/** Half-width allowance for a name under a pie, for the crop. */
const NAME_HALF_W = 60;
/** Arrow shaft width: linear in the To-Sky amount, biggest at W_MAX. */
const W_MAX = 22;
const W_MIN = 3;
const HEAD_LEN = 16;
const HEAD_FLARE = 7;
/** Smallest Sky wedge, so a hairline contribution ($497 of $15.5M) still
 *  shows and its arrow still has a distinguishable dock point. */
const MIN_WEDGE = 0.05;
/** Keep a dock point this fraction of its wedge's span inside either edge. */
const DOCK_INSET = 0.15;
/** Permanent figure labels: a slice/wedge shows its amount when the arc at
 *  its label radius is at least this long (px), a pie its gross under the
 *  name always. */
const FIGURE_MIN_ARC = 58;
/** How far (radians) a Prime may sit from its own wedge before its slot is
 *  pulled toward it — beyond this the arrow would cross the donut. */
const MAX_LEAN = Math.PI / 3;
/** Leader length from a mark to its hover pill. */
const PILL_OFFSET = 40;

/** Working canvas height (see WIDTH). */
export const HEIGHT = 2 * (R_MAX + DONUT_GAP + 2 * R_MAX + 2 * LABEL_OUT + 8);

/** Slice kinds, in the pie's clockwise order: the To-Sky pair first (they
 *  face Sky), then supply kept, then the demand-side series. */
export const SLICE_KINDS = ["cof", "sde", "kept", ...DEMAND_SERIES.map((s) => s.key)] as const;
export type SliceKind = "cof" | "sde" | "kept" | DemandKey;

export interface RingSlice {
  kind: SliceKind;
  /** Always positive here — a negative item becomes the hole. */
  signed: number;
  /** Angular extent (radians). */
  a0: number;
  a1: number;
  path: string;
  /** Where the pill's leader touches the slice (its mid-radius). */
  amountX: number;
  amountY: number;
  /** Where the hover pill sits — outside the pie on the slice's radial. */
  pillX: number;
  pillY: number;
  /** Permanent figure inside the slice, when it has room. */
  figureX: number | null;
  figureY: number | null;
}

/** The loss hole: every negative line item, summed. */
export interface RingHole {
  /** Negative. */
  signed: number;
  /** Which items were negative (usually just supply kept). */
  kinds: SliceKind[];
  r: number;
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
  /** Permanent figure inside the wedge, when it has room. */
  figureX: number | null;
  figureY: number | null;
}

export interface RingPrime {
  /** Workbook prime key ("spark"). */
  prime: string;
  /** Angle of the pie's center around Sky (radians, 12 o'clock = −π/2). */
  angle: number;
  /** Pie center and outer radius (area ∝ the positive line items). */
  cx: number;
  cy: number;
  r: number;
  /** Slices, clockwise, To-Sky pair first. */
  slices: RingSlice[];
  /** Loss hole, or null when no item is negative. */
  hole: RingHole | null;
  /** The To-Sky arrow, or null for a prime that pays Sky nothing. */
  arrow: RingArrow | null;
  /** Gross revenue: To-Sky + kept + demand (signed) — the ring's area. */
  gross: number;
  /** Name, centered outside the pie on the side away from Sky. */
  labelX: number;
  labelY: number;
  /** Where the gross-revenue pill sits (off the name) and its anchor. */
  grossPillX: number;
  grossPillY: number;
  grossAnchorX: number;
  grossAnchorY: number;
}

export interface RingLayout {
  /** The viewBox: cropped to the month's content, plus padding. The
   *  rendered size comes from CSS (the card), so a changing box rescales
   *  the drawing rather than reflowing the page. */
  x: number;
  y: number;
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

/** Annular sector from a0 to a1 (the whole ring when it is the only
 *  slice; render with fill-rule evenodd). rIn = 0 gives a plain sector. */
function annulusPath(cx: number, cy: number, rOut: number, rIn: number, a0: number, a1: number): string {
  const pt = (r: number, a: number) => `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
  if (a1 - a0 >= 2 * Math.PI - 1e-6) {
    const ring = (r: number) =>
      `M${cx + r},${cy} A${r},${r} 0 1 1 ${cx - r},${cy} A${r},${r} 0 1 1 ${cx + r},${cy} Z`;
    return rIn > 0 ? `${ring(rOut)} ${ring(rIn)}` : ring(rOut);
  }
  const large = a1 - a0 > Math.PI ? 1 : 0;
  if (rIn <= 0) {
    return `M${cx},${cy} L${pt(rOut, a0)} A${rOut},${rOut} 0 ${large} 1 ${pt(rOut, a1)} Z`;
  }
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

/** Pie center of a prime at orbit angle t. */
function orbit(t: number, cy: number): [number, number] {
  return [CX + ORBIT_RX * Math.cos(t), cy + ORBIT_RY * Math.sin(t)];
}

/** The prime's line items, signed, in slice order. */
function lineItems(p: PrimeFlowTotals): Array<{ kind: SliceKind; signed: number }> {
  const items: Array<{ kind: SliceKind; signed: number }> = [
    { kind: "cof", signed: p.cof },
    { kind: "sde", signed: p.sde },
    { kind: "kept", signed: p.kept },
    ...DEMAND_SERIES.map((s) => ({ kind: s.key, signed: p.demandParts[s.key] ?? 0 })),
  ];
  return items.filter((it) => Math.abs(it.signed) >= SETTLEMENT_NEAR_ZERO);
}

export function layoutMscRing(
  primes: readonly PrimeFlowTotals[],
  _labelOf: (prime: string) => string = (p) => p,
): RingLayout {
  const cy = HEIGHT / 2;
  const rows = primes
    .map((p) => {
      const items = lineItems(p);
      const sky = Math.abs(p.sky) >= SETTLEMENT_NEAR_ZERO ? p.sky : 0;
      const positives = items.filter((it) => it.signed > 0).reduce((n, it) => n + it.signed, 0);
      const loss = items.filter((it) => it.signed < 0).reduce((n, it) => n - it.signed, 0);
      return { p, items, sky, positives, loss, gross: positives - loss };
    })
    .filter((r) => r.items.length > 0 || r.sky !== 0);

  const empty: RingLayout = {
    x: 0,
    y: 0,
    width: WIDTH,
    height: HEIGHT,
    cx: CX,
    cy,
    skyR: SKY_MIN_R,
    skyInnerR: 0,
    skyWedges: [],
    primes: [],
  };
  if (rows.length === 0) return empty;

  const maxSky = Math.max(1, ...rows.map((r) => Math.abs(r.sky)));
  const widthOf = (v: number) => Math.max(W_MIN, (W_MAX * v) / maxSky);

  // Area ∝ dollars on one scale shared by the donut and the pies, pinned so
  // the month's biggest amount is R_MAX. A pie's outer area is its positive
  // items; its hole's area is its loss; the visible ring is gross revenue.
  const skyTotal = rows.reduce((n, r) => n + Math.abs(r.sky), 0);
  const ref = Math.max(1, skyTotal, ...rows.map((r) => r.positives));
  const radiusFor = (v: number) => R_MAX * Math.sqrt(Math.max(0, v) / ref);
  const skyR = Math.max(SKY_MIN_R, radiusFor(skyTotal));
  const skyInnerR = 0;

  const shape = rows.map((r) => {
    const r0 = Math.max(PIE_MIN_R, radiusFor(r.positives));
    const holeR = r.loss > 0 ? Math.min(r0 - HOLE_RIM, Math.max(HOLE_MIN_R, radiusFor(r.loss))) : 0;
    return { r: r0, holeR, spaceR: r0 + LABEL_OUT };
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
    const mid = (a0 + a1) / 2;
    // Figures sit at 0.72·R, clear of the center label's plate.
    const fr = skyR * 0.72;
    const room = (a1 - a0) * fr >= FIGURE_MIN_ARC && skyR >= 100;
    return {
      prime: x.r.p.prime,
      path: annulusPath(CX, cy, skyR, skyInnerR, a0, a1),
      a0,
      a1,
      mid,
      value: Math.abs(x.r.sky),
      figureX: room ? CX + fr * Math.cos(mid) : null,
      figureY: room ? cy + fr * Math.sin(mid) : null,
    };
  });

  // Target angles: slots clockwise from 12 o'clock in row order, each
  // proportional to the pie's footprint, with the first pie centered at the
  // top — so two big pies sit far apart and small ones tuck in close. A
  // contributor whose slot is more than MAX_LEAN from its own wedge is
  // pulled to MAX_LEAN of the wedge's nearest edge, so its arrow can still
  // reach the wedge without cutting across Sky. The relaxation below then
  // moves Primes off their slots only where pies collide.
  const weights = shape.map((s) => s.spaceR + CLEARANCE / 2);
  const totalW = weights.reduce((n, w) => n + w, 0) || 1;
  const angles: number[] = [];
  let cum = 0;
  for (const w of weights) {
    angles.push(norm(-Math.PI / 2 + ((cum + w / 2 - weights[0] / 2) / totalW) * TWO_PI));
    cum += w;
  }
  for (const [i, r] of rows.entries()) {
    const range = wedgeRange.get(r.p.prime);
    if (!range) continue;
    const [a0, a1] = range;
    const mid = (a0 + a1) / 2;
    const half = (a1 - a0) / 2;
    const off = angDiff(mid, angles[i]);
    if (Math.abs(off) > half + MAX_LEAN) angles[i] = norm(mid + Math.sign(off) * (half + MAX_LEAN));
  }

  // Where prime i's pie lands at orbit angle t: pushed straight out from
  // Sky until it clears the donut by DONUT_GAP.
  const placed = (i: number, t: number) => {
    let [x, y] = orbit(t, cy);
    const d = Math.hypot(x - CX, y - cy) || 1;
    const need = skyR + shape[i].spaceR + DONUT_GAP;
    if (d < need) {
      x += ((x - CX) / d) * (need - d);
      y += ((y - cy) / d) * (need - d);
    }
    return { x, y };
  };

  // Relaxation: push orbital neighbours apart until their pies (+ names)
  // clear each other.
  const order = rows.map((_, i) => i);
  for (let pass = 0; pass < 24; pass++) {
    order.sort((a, b) => angles[a] - angles[b]);
    let moved = false;
    for (let k = 0; k < order.length && order.length > 1; k++) {
      const i = order[k];
      const j = order[(k + 1) % order.length];
      if (i === j) continue;
      const pi = placed(i, angles[i]);
      const pj = placed(j, angles[j]);
      const d = Math.hypot(pi.x - pj.x, pi.y - pj.y);
      const need = shape[i].spaceR + shape[j].spaceR + CLEARANCE;
      if (d >= need) continue;
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
    const { x: px, y: py } = placed(i, t);
    const s = shape[i];
    const toward = Math.atan2(py - cy, px - CX);

    // Slices: positive items clockwise, rotated so the To-Sky pair is
    // centered on the direction to Sky (the arrow leaves from them).
    const positives = r.items.filter((it) => it.signed > 0);
    const total = r.positives || 1;
    const toSkyShare = positives
      .filter((it) => it.kind === "cof" || it.kind === "sde")
      .reduce((n, it) => n + it.signed / total, 0);
    // Direction to Sky = toward + π.
    let a = toward + Math.PI - toSkyShare * Math.PI;
    const slices: RingSlice[] = positives.map((it) => {
      const span = (it.signed / total) * TWO_PI;
      const a0 = a;
      const a1 = a + span;
      a = a1;
      const mid = (a0 + a1) / 2;
      const midR = (s.r + s.holeR) / 2;
      const amountX = px + midR * Math.cos(mid);
      const amountY = py + midR * Math.sin(mid);
      // A permanent figure when the slice's arc at mid-radius has room for
      // a short "$2.9M" and the ring is thick enough to hold a line of text.
      const room = span * midR >= FIGURE_MIN_ARC && s.r - s.holeR >= 34;
      return {
        kind: it.kind,
        signed: it.signed,
        a0,
        a1,
        path: annulusPath(px, py, s.r, s.holeR, a0, a1),
        amountX,
        amountY,
        pillX: px + (s.r + PILL_OFFSET) * Math.cos(mid),
        pillY: py + (s.r + PILL_OFFSET) * Math.sin(mid),
        figureX: room ? amountX : null,
        figureY: room ? amountY : null,
      };
    });

    const hole: RingHole | null =
      r.loss > 0
        ? {
            signed: -r.loss,
            kinds: r.items.filter((it) => it.signed < 0).map((it) => it.kind),
            r: s.holeR,
            // Off the pie on the side away from Sky.
            pillX: px + (s.r + PILL_OFFSET) * Math.cos(toward),
            pillY: py + (s.r + PILL_OFFSET) * Math.sin(toward),
          }
        : null;

    // The arrow leaves the pie's edge toward the nearest point of this
    // prime's own wedge and ends on the donut's outer edge.
    let arrow: RingArrow | null = null;
    const range = wedgeRange.get(r.p.prime);
    if (r.sky !== 0 && range) {
      const [a0, a1] = range;
      const mid = (a0 + a1) / 2;
      const half = Math.max(0, ((a1 - a0) / 2) * (1 - 2 * DOCK_INSET));
      const dock = mid + Math.max(-half, Math.min(half, angDiff(mid, toward)));
      const x1 = CX + skyR * Math.cos(dock);
      const y1 = cy + skyR * Math.sin(dock);
      const dx = x1 - px;
      const dy = y1 - py;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const x0 = px + ux * (s.r + 2);
      const y0 = py + uy * (s.r + 2);
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

    // Name outside the pie on the side away from Sky (above for the upper
    // half, below for the lower), with the gross figure always on the line
    // UNDER the name (labelY + 16, drawn by the view), so the two read the
    // same way everywhere; the gross pill goes beyond both.
    const above = py <= cy;
    const labelY = above ? py - s.r - 30 : py + s.r + 18;
    return {
      prime: r.p.prime,
      angle: t,
      cx: px,
      cy: py,
      r: s.r,
      slices,
      hole,
      arrow,
      gross: r.gross,
      labelX: px,
      labelY,
      // Clear of the name + figure pair.
      grossPillX: px,
      grossPillY: above ? labelY - 28 : labelY + 44,
      grossAnchorX: px,
      grossAnchorY: above ? labelY - 12 : labelY + 22,
    };
  });

  return { ...empty, ...fitViewBox(out, skyR, cy), skyR, skyInnerR, skyWedges, primes: out };
}

/** The bounding box of everything drawn — Sky, every pie, its name and
 *  figure line — plus padding. */
function fitViewBox(primes: RingPrime[], skyR: number, cy: number) {
  let x0 = CX - skyR;
  let x1 = CX + skyR;
  let y0 = cy - skyR;
  let y1 = cy + skyR;
  for (const p of primes) {
    x0 = Math.min(x0, p.cx - p.r, p.labelX - NAME_HALF_W);
    x1 = Math.max(x1, p.cx + p.r, p.labelX + NAME_HALF_W);
    // The name's line box is ~18px tall, the figure sits 16px under it.
    y0 = Math.min(y0, p.cy - p.r, p.labelY - 14);
    y1 = Math.max(y1, p.cy + p.r, p.labelY + 22);
  }
  return {
    x: x0 - CROP_PAD,
    y: y0 - CROP_PAD,
    width: x1 - x0 + 2 * CROP_PAD,
    height: y1 - y0 + 2 * CROP_PAD,
  };
}
