// Orbital-chart geometry for the /radar MSC overview: Sky as a central
// PIE, subdivided into one wedge per Prime by its share of the To-Sky
// total, and each Prime as a PIE of its gross-revenue line items orbiting
// it, with an arrow from the pie's To-Sky slices into its own wedge. (Sky
// is a full pie, not a donut: on this chart a hole means a loss.)
// Pure math, no DOM — the view just maps over prebuilt SVG path strings
// (settlementSankey.ts precedent).
//
// ONE size scale for everything: the month's biggest amount (the To-Sky
// total, or a Prime's positive line items) renders at R_MAX, and every
// other circle is sized from the same scale — a compressed one, not an
// area-proportional one, because the month's amounts span three orders of
// magnitude and true area put half the Primes on the minimum. See SIZE_EXP
// for the trade that buys.
//
// EVERY PIE IS WHAT THAT PARTY RECEIVED, and nothing else — the one rule
// that makes a pie's size mean something. Mixing what a Prime keeps with
// what it owes Sky (the old "gross revenue" pie) summed money moving in
// opposite directions, which the Monthly Settlement Cycle settles as two
// separate amounts (A.2.4.1.2.2.1.1.1 and A.2.4.1.2.2.1.1.2). So:
//
//   A PRIME'S PIE  = supply kept (prime agent revenue − cost of funds)
//                    + agent rate, distribution rewards, accessibility
//                      rewards, Chronicle points
//   SKY'S PIE      = cost of funds + Sky Direct Exposure, subdivided by
//                    Prime so "these flows add up to Sky" stays visible
//
// Positive items are the slices, and the pie's SIZE comes from their sum.
// A negative item (a supply LOSS — Grove in 3 of 7 months) is a HOLE in
// the middle sized from the loss on the same scale, so the visible ring is
// what the party received. Two arrows run between each Prime and Sky, in
// opposite lanes: what it owed Sky, and the demand-side Sky owed it.
//
// Placement: Primes go clockwise from 12 o'clock in the order given (the
// caller passes PRIME_ORDER), each given an angular slot proportional to
// its footprint — big pies get room, small ones sit close to their
// neighbours; a relaxation pass then pushes neighbours apart only where
// pies would still touch. Wedges are laid out in that same order, so a
// Prime's own wedge is always on its side of Sky, and its arrow docks at
// the nearest point of that wedge, never closer than DOCK_INSET of the
// wedge's span to either edge.
//
// Transitions: a row's `alpha` (set by tweenPrimeFlows for a Prime only
// one of two months has) scales every FLOOR and every reserve of room the
// row gets — the minimum pie, its name's room, its clearance, its minimum
// wedge — so a Prime arriving from nothing takes up nothing at first and
// the others drift over as it grows, instead of jumping to make it a slot.

import { DEMAND_SERIES, SETTLEMENT_NEAR_ZERO, formatUsd, type DemandKey } from "@/lib/settlements";
import type { PrimeFlowTotals } from "@/lib/settlementsOverview";
import { textWidth } from "./textWidth";

/** Working canvas the layout is computed on. The viewBox the chart ships
 *  is then CROPPED to what got drawn (see `fitViewBox`), so the frame is
 *  never taller than its content and the card's height sets the scale. */
export const WIDTH = 1300;
const CX = WIDTH / 2;
/** Orbit circle the pie centers start on — a lower bound; a pie that would
 *  lean into Sky is pushed further out. Round, so no direction is favoured.
 *  RX is the free parameter that keeps the cropped box's aspect near the
 *  card's own (~950:420): the bottom arc sets the height, so when Sky and
 *  the pies grow, RX has to grow with them or the box turns square, the
 *  height starts binding and every label on screen gets smaller. */
const ORBIT_RX = 600;
const ORBIT_RY = 250;
/** Where the first Prime sits: 9 o'clock. The card is wide, so the big
 *  Primes (first in PRIME_ORDER) take the sides and the small ones the
 *  top/bottom, which keeps the cropped box wide and the drawing large. */
const START_ANGLE = Math.PI;
/** Sky pie: on the SAME size scale as the pies (see R_MAX), with a floor
 *  so the label always fits. No hole — a hole means a loss here. */
const SKY_MIN_R = 100;
/** ONE size scale for the donut and every pie: the month's biggest
 *  amount renders at this radius — in practice Sky, which is four times
 *  the biggest Prime in every published month.
 *
 *  Spending this is not free and not a no-op. The viewBox is cropped to
 *  the content and the card's height sets the scale, so growing every
 *  circle by the same factor would cancel out — but the FLOOR and the
 *  label type do not grow with it, so a bigger R_MAX buys real room at
 *  the small end and pushes the type down relative to the drawing. It is
 *  bounded by the crop going TALL: the bottom Primes are pushed out to
 *  skyR + their own radius + DONUT_GAP, so each unit of R_MAX costs two
 *  units of the box's height, the card scales the box to fit, and past
 *  some point the labels lose more than the circles gain. 170 (with
 *  ORBIT_RX widened to match) is where that trade stops paying. */
const R_MAX = 170;
/**
 * The size exponent: radius = R_MAX * (value / ref) ** SIZE_EXP.
 *
 * 0.5 is true area-proportionality (area ∝ dollars) and is what this chart
 * used to do. It cannot survive this data: a month spans three orders of
 * magnitude between the biggest Prime and the smallest ($3.92M vs $12.1k in
 * Jul 2026), and against a `ref` that is the To-Sky total — four times the
 * biggest Prime — every Prime below ~$500k came out under the minimum pie
 * and rendered at exactly the same size. Three or four of six rows were
 * sized by the FLOOR rather than by their money, which is the one thing a
 * size encoding must never do.
 *
 * A Flannery-style compromise is the way out: still one monotone scale
 * shared by the donut and every pie, so bigger always means more and the
 * ranking is exact, but a pie's AREA is no longer readable as dollars — it
 * overstates the small end on purpose. Read the figures for amounts; read
 * the circles for rank and rough magnitude. MscRingKey's reading guide
 * says exactly that — keep the two in step if this number moves.
 *
 * 0.45, not the 0.3 first shipped: 0.3 fixed the pile-up but squeezed the
 * whole set into a 3.6–5.7× span of radius over a 324× span of money,
 * which read as "the pies are all much of a muchness". The exponent, the
 * FLOOR and R_MAX are three independent levers and all three had to move
 * — raising the exponent alone drives the small end straight back under
 * the floor. With R_MAX at 170 and the floor at 7, measured over all
 * seven published months, 0.45 nearly doubles the span again (6.7–13.1×)
 * while still putting at most one row on the minimum.
 *
 * 0.45 and not 0.5 is a measured stop, not a taste: at true area Jan 2026
 * renders Keel ($28.5k) at 7.1 and Grove ($6.3k) at the 7.0 floor — two
 * rows a 4.5× difference apart, the same size. That is the exact defect
 * this scale exists to prevent, so area-proportionality cannot come back
 * until the floor can go lower than a hoverable disc.
 */
const SIZE_EXP = 0.45;
/** Smallest pie, so a Prime that rounds to nothing is still a visible,
 *  hoverable disc. Deliberately well below the smallest real row — the
 *  floor is a backstop for a row with no money, never the thing that sizes
 *  the small end, and it has to stay below whatever SIZE_EXP gives the
 *  smallest real Prime or the pile-up comes straight back. */
const PIE_MIN_R = 7;
/** A loss hole is never smaller than this (a hairline hole reads as a
 *  rendering glitch) nor closer than HOLE_RIM to the pie's edge. Both sit
 *  under PIE_MIN_R, or the floor pie would be all hole. */
const HOLE_MIN_R = 4;
const HOLE_RIM = 4;
/** Minimum clearance between two pies (including their names). */
const CLEARANCE = 22;
/** Minimum gap between a pie and the donut — room for the arrow. */
const DONUT_GAP = 70;
/** Room reserved outside a pie for its name and received figure (2 lines):
 *  NAME_SIZE + SUBLABEL_DY + LABEL_GAP, spelled out rather than derived
 *  because it is declared above the type block. Keep it in step. */
const LABEL_OUT = 74;
/** Padding around the cropped viewBox. */
const CROP_PAD = 24;
/** Half-width allowance for a name under a pie, for the crop. */
const NAME_HALF_W = 106;
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
/**
 * TYPE. Every size on this chart lives here and is exported, because the
 * layout MEASURES the same strings the view draws: a size the view hard-
 * codes and the layout does not know about silently breaks `fitInSector`
 * (a figure placed where its real box does not fit) and `fitViewBox` (a
 * name cropped off the frame). The view imports these; it never writes a
 * number of its own.
 *
 * The working canvas is ~1250×700 and the card renders it about 0.55×, so
 * these are roughly doubled from the 15/24/16 they were: at 15px the
 * in-slice figures landed near 8px on screen, which is what "all labels
 * are too small" meant. The cost is paid by `fitInSector` — bigger boxes
 * fit inside fewer slices, so a few figures fall back to the hover pill.
 */
export const NAME_SIZE = 32;
export const SUBLABEL_SIZE = 22;
export const FIGURE_SIZE = 21;
/** Baseline-to-baseline for a name and the figure line under it, and the
 *  gap that pair keeps from the pie's rim. */
export const SUBLABEL_DY = 28;
const LABEL_GAP = 14;
/** Sky's name + total sit above its disc on the same pattern. */
export const SKY_LABEL_DY = 24 + SUBLABEL_DY;
export const SKY_SUBLABEL_DY = 24;
/** The wedge's two lines straddle the fitted centre (see MscRing). */
export const WEDGE_TSPAN_DY = [-6, 25] as const;
/** Permanent figure labels: a slice or wedge shows its figure only when the
 *  measured text box fits INSIDE it — inside the pie's edge, clear of the
 *  hole, within the slice's angles — at one of a few radii along its
 *  mid-angle (see fitInSector). A pie's received total goes under the name.
 *  The CHAR_PX numbers are textWidth's jsdom fallback for these exact font
 *  strings and MUST move with the sizes above, or every measurement in the
 *  test environment silently goes wrong. */
const FIGURE_FONT = `${FIGURE_SIZE}px 'Source Code Pro', 'Courier New', monospace`;
const FIGURE_CHAR_PX = 12.7;
const NAME_FONT = `${NAME_SIZE}px 'Inter', system-ui, sans-serif`;
const NAME_CHAR_PX = 17.5;
/** Line box of one figure line, and the two-line wedge label. */
const FIGURE_H = 22;
const WEDGE_LABEL_H = 48;
/** Breathing room between a figure's box and any edge. */
const FIGURE_PAD = 5;

/** Short codes for the pie's line items — what the in-slice figures and
 *  the key use ("CoF $7.86M"). Lives here because the layout measures them. */
export const SLICE_CODE: Record<string, string> = {
  cof: "CoF",
  sde: "SDE",
  kept: "kept",
  agentRate: "AR",
  distributionRewards: "DR",
  gar: "GAR",
  chroniclePoints: "CP",
};
/** How far (radians) a Prime may sit from its own wedge before its slot is
 *  pulled toward it — beyond this the arrow would cross the donut. */
const MAX_LEAN = Math.PI / 3;
/** Leader length from a mark to its hover pill — grown with the pill's own
 *  type (MscRingPills' `scale`), so the pill still clears the mark. */
const PILL_OFFSET = 56;
/** Clearance between the two arrow lanes of one Prime. */
const LANE_GAP = 3;

/** Working canvas height (see WIDTH). */
export const HEIGHT = 2 * (R_MAX + DONUT_GAP + 2 * R_MAX + 2 * LABEL_OUT + 8);

/** Slice kinds, in the pie's clockwise order: the To-Sky pair first (they
 *  face Sky), then supply kept, then the demand-side series. */
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
  /** "sky" runs Prime → Sky (what it owed); "demand" runs Sky → Prime
   *  (A.2.4.1.2.2.1.1.1). They travel in opposite lanes of the same
   *  corridor, so the two-way traffic is visible. */
  kind: "sky" | "demand";
  /** Magnitude of the whole arrow (cof + sde); sign in `signed`. */
  value: number;
  signed: number;
  /** Its two components (signed). */
  cof: number;
  sde: number;
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
  /** Mid-transition opacity of a Prime entering or leaving (else 1). */
  alpha: number;
  /** Sky's pie is what SKY received, so a wedge splits into the two things
   *  it is made of: cost of funds and Sky Direct Exposure. Only the
   *  non-zero ones, cost of funds first. */
  parts: { kind: "cof" | "sde"; value: number; path: string }[];
}

export interface RingPrime {
  /** Workbook prime key ("spark"). */
  prime: string;
  /** Angle of the pie's center around Sky (radians, 12 o'clock = −π/2). */
  angle: number;
  /** Pie center and outer radius (sized from the positive line items on
   *  the shared SIZE_EXP scale — bigger means more, not area ∝ dollars). */
  cx: number;
  cy: number;
  r: number;
  /** Slices, clockwise, To-Sky pair first. */
  slices: RingSlice[];
  /** Loss hole, or null when no item is negative. */
  hole: RingHole | null;
  /** The To-Sky arrow, or null for a prime that pays Sky nothing. */
  arrow: RingArrow | null;
  /** The demand-side arrow FROM Sky, or null when Sky owes it nothing. */
  demandArrow: RingArrow | null;
  /** What this Prime received: supply kept + demand-side (signed) — what
   *  the ring stands for. Never its To-Sky money, which is Sky's receipt. */
  received: number;
  /** Name, centered outside the pie on the side away from Sky. */
  labelX: number;
  labelY: number;
  /** Where the gross-revenue pill sits (off the name) and its anchor. */
  grossPillX: number;
  grossPillY: number;
  grossAnchorX: number;
  grossAnchorY: number;
  /** Mid-transition opacity of a Prime entering or leaving (else 1). */
  alpha: number;
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

/** Center for a w×h text box inside the sector a0..a1 of the ring
 *  rIn..rOut around (cx, cy), tried at a few radii along the mid-angle from
 *  the ring's middle inward. Every corner must be inside the outer edge and
 *  within the sector's angles, and the box's nearest point must clear the
 *  hole. Null when no radius works: the figure then lives in the hover pill
 *  rather than running off the pie. */
function fitInSector(
  cx: number,
  cy: number,
  rOut: number,
  rIn: number,
  a0: number,
  a1: number,
  w: number,
  h: number,
): { x: number; y: number } | null {
  const mid = (a0 + a1) / 2;
  const span = a1 - a0;
  const hw = w / 2 + FIGURE_PAD;
  const hh = h / 2 + FIGURE_PAD;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const radii = [(rOut + rIn) / 2, rOut * 0.62, rOut * 0.5, rOut * 0.4, rOut * 0.3];
  for (const fr of radii) {
    const x = cx + fr * Math.cos(mid);
    const y = cy + fr * Math.sin(mid);
    const corners = [
      [x - hw, y - hh],
      [x + hw, y - hh],
      [x - hw, y + hh],
      [x + hw, y + hh],
    ];
    if (corners.some(([px, py]) => Math.hypot(px - cx, py - cy) > rOut)) continue;
    if (rIn > 0) {
      const nx = clamp(cx, x - hw, x + hw);
      const ny = clamp(cy, y - hh, y + hh);
      if (Math.hypot(nx - cx, ny - cy) < rIn + FIGURE_PAD) continue;
    }
    if (
      span < TWO_PI - 1e-6 &&
      corners.some(([px, py]) => Math.abs(angDiff(Math.atan2(py - cy, px - cx), mid)) > span / 2)
    )
      continue;
    return { x, y };
  }
  return null;
}
const norm = (a: number) => ((a % TWO_PI) + TWO_PI) % TWO_PI;
/** Signed shortest angular distance from a to b. */
const angDiff = (a: number, b: number) => norm(b - a + Math.PI) - Math.PI;

/** Pie center of a prime at orbit angle t. */
function orbit(t: number, cy: number): [number, number] {
  return [CX + ORBIT_RX * Math.cos(t), cy + ORBIT_RY * Math.sin(t)];
}

/** What the PRIME received, signed, in slice order: what it kept supply-side
 *  and the demand-side series Sky owes it. Cost of funds and Sky Direct
 *  Exposure are deliberately absent — those are Sky's receipts and belong to
 *  Sky's pie, not to a pie of the Prime's. */
function primeItems(p: PrimeFlowTotals): Array<{ kind: SliceKind; signed: number }> {
  const items: Array<{ kind: SliceKind; signed: number }> = [
    { kind: "kept", signed: p.kept },
    ...DEMAND_SERIES.map((s) => ({ kind: s.key, signed: p.demandParts[s.key] ?? 0 })),
  ];
  return items.filter((it) => Math.abs(it.signed) >= SETTLEMENT_NEAR_ZERO);
}

export function layoutMscRing(
  primes: readonly PrimeFlowTotals[],
  labelOf: (prime: string) => string = (p) => p,
): RingLayout {
  const cy = HEIGHT / 2;
  const rows = primes
    .map((p) => {
      const items = primeItems(p);
      const sky = Math.abs(p.sky) >= SETTLEMENT_NEAR_ZERO ? p.sky : 0;
      const positives = items.filter((it) => it.signed > 0).reduce((n, it) => n + it.signed, 0);
      const loss = items.filter((it) => it.signed < 0).reduce((n, it) => n - it.signed, 0);
      // The demand-side arrow's magnitude: what Sky owes this Prime.
      const demand = items
        .filter((it) => it.kind !== "kept" && it.signed > 0)
        .reduce((n, it) => n + it.signed, 0);
      const alpha = Math.max(0, Math.min(1, p.alpha ?? 1));
      return { p, items, sky, positives, loss, demand, received: positives - loss, alpha };
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

  // Both arrow lanes share one width scale, so a To-Sky arrow and a
  // demand-side arrow of the same size look the same size.
  const maxFlow = Math.max(1, ...rows.map((r) => Math.max(Math.abs(r.sky), r.demand)));
  const widthOf = (v: number) => Math.max(W_MIN, (W_MAX * v) / maxFlow);

  // One size scale shared by the donut and the pies (see SIZE_EXP), pinned
  // so the month's biggest amount is R_MAX. A pie's outer circle is its
  // positive items, its hole is its loss, and the ring between them is what
  // it received — in rank, not in area: SIZE_EXP is not 0.5.
  const skyTotal = rows.reduce((n, r) => n + Math.abs(r.sky), 0);
  const ref = Math.max(1, skyTotal, ...rows.map((r) => r.positives));
  const radiusFor = (v: number) => R_MAX * Math.pow(Math.max(0, v) / ref, SIZE_EXP);
  const skyR = Math.max(SKY_MIN_R, radiusFor(skyTotal));
  const skyInnerR = 0;

  // Floors and reserved room scale with the row's alpha (1 for a real row).
  // A row mid-transition also has its RADIUS damped, by alpha ** (0.5 −
  // SIZE_EXP): the tween scales a newcomer's money linearly, and under a
  // flatter exponent that alone would have it pop to half size a tenth of
  // the way in. The damping puts the arrival back on the square-root curve
  // it grew in on when the chart was area-proportional, so changing
  // SIZE_EXP re-sizes the pies without re-timing the transition.
  const shape = rows.map((r) => {
    const grow = r.alpha < 1 ? Math.pow(r.alpha, 0.5 - SIZE_EXP) : 1;
    const r0 = Math.max(PIE_MIN_R * r.alpha, radiusFor(r.positives) * grow);
    const holeR =
      r.loss > 0 ? Math.max(0, Math.min(r0 - HOLE_RIM, Math.max(HOLE_MIN_R * r.alpha, radiusFor(r.loss) * grow))) : 0;
    return { r: r0, holeR, spaceR: r0 + LABEL_OUT * r.alpha, clear: (CLEARANCE / 2) * r.alpha };
  });

  // Sky's wedges in row order (the caller's PRIME_ORDER), rotated so the
  // first contributor's wedge is centered at 12 o'clock.
  const contributors = rows.map((r, i) => ({ r, i })).filter((x) => x.r.sky !== 0);
  const floorShare = MIN_WEDGE / TWO_PI;
  const shares = contributors.map((x) => Math.max(Math.abs(x.r.sky) / (skyTotal || 1), floorShare * x.r.alpha));
  const shareSum = shares.reduce((n, s) => n + s, 0) || 1;
  const spans = shares.map((s) => (s / shareSum) * TWO_PI);
  let wa = START_ANGLE - (spans[0] ?? 0) / 2;
  const wedgeRange = new Map<string, [number, number]>();
  const skyWedges: RingSkyWedge[] = contributors.map((x, j) => {
    const a0 = wa;
    const a1 = wa + spans[j];
    wa = a1;
    wedgeRange.set(x.r.p.prime, [a0, a1]);
    const mid = (a0 + a1) / 2;
    // Name over amount, two lines — placed only where the measured box fits.
    const value = Math.abs(x.r.sky);
    const w = Math.max(
      textWidth(labelOf(x.r.p.prime), NAME_FONT, NAME_CHAR_PX),
      textWidth(formatUsd(value, true), FIGURE_FONT, FIGURE_CHAR_PX),
    );
    const fit = fitInSector(CX, cy, skyR, skyInnerR, a0, a1, w, WEDGE_LABEL_H);
    // Split the wedge by what it is made of. Only positive components get a
    // sub-slice; a negative SDE (Spark, Jul 2026) leaves cost of funds as
    // the whole wedge rather than drawing a backwards slice.
    const comps = ([
      { kind: "cof" as const, value: x.r.p.cof },
      { kind: "sde" as const, value: x.r.p.sde },
    ]).filter((c) => c.value >= SETTLEMENT_NEAR_ZERO);
    const compSum = comps.reduce((n, c) => n + c.value, 0) || 1;
    let pa = a0;
    const parts = comps.map((c) => {
      const p0 = pa;
      const p1 = comps.length === 1 ? a1 : pa + ((a1 - a0) * c.value) / compSum;
      pa = p1;
      return { kind: c.kind, value: c.value, path: annulusPath(CX, cy, skyR, skyInnerR, p0, p1) };
    });
    return {
      prime: x.r.p.prime,
      path: annulusPath(CX, cy, skyR, skyInnerR, a0, a1),
      a0,
      a1,
      mid,
      value,
      figureX: fit?.x ?? null,
      figureY: fit?.y ?? null,
      alpha: x.r.alpha,
      parts,
    };
  });

  // Target angles. The card is wide, so the first two Primes in the order
  // (Spark and Grove, the big ones) anchor 9 and 3 o'clock, and the rest
  // run clockwise across the bottom arc between them, each with a slot
  // proportional to its footprint — the order Spark → Grove → Keel →
  // Skybase → Obex → Osero is still clockwise, it just starts on the left
  // and skips the top, where Sky's own height already sets the frame. A
  // contributor whose slot is more than MAX_LEAN from its own wedge is
  // pulled to MAX_LEAN of the wedge's nearest edge, so its arrow can still
  // reach the wedge without cutting across Sky. The relaxation below then
  // moves Primes off their slots only where pies collide.
  const angles: number[] = rows.map(() => 0);
  if (rows.length >= 1) angles[0] = norm(START_ANGLE);
  if (rows.length >= 2) angles[1] = norm(START_ANGLE + Math.PI);
  if (rows.length >= 3) {
    const rest = rows.map((_, i) => i).slice(2);
    const weights = rest.map((i) => shape[i].spaceR + shape[i].clear);
    // Edge margins so the first/last of the rest clear Grove/Spark.
    const edge = (shape[1].spaceR + shape[0].spaceR) / 2 + shape[0].clear + shape[1].clear;
    const totalW = weights.reduce((n, w) => n + w, 0) + edge;
    let cum = edge / 2;
    rest.forEach((i, k) => {
      angles[i] = norm(START_ANGLE + Math.PI + ((cum + weights[k] / 2) / totalW) * Math.PI);
      cum += weights[k];
    });
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
  //
  // The PIE's radius is what has to clear, not `spaceR` — a Prime's name
  // is always drawn on the side AWAY from Sky (see labelY below), so the
  // room reserved for it never sits in this corridor. Reserving it here
  // pushed every Prime a whole label further out for nothing, and since
  // the bottom arc is what sets the cropped box's height, that was ~70
  // units of dead vertical on a drawing the card scales to fit.
  const placed = (i: number, t: number) => {
    let [x, y] = orbit(t, cy);
    const d = Math.hypot(x - CX, y - cy) || 1;
    const need = skyR + shape[i].r + DONUT_GAP;
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
      const need = shape[i].spaceR + shape[i].clear + shape[j].spaceR + shape[j].clear;
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

    // Slices: positive items clockwise, rotated so the DEMAND-side run is
    // centered on the direction to Sky — that is the money the demand
    // arrow brings in from there, so it lands where it belongs. (It used
    // to be the To-Sky pair, which this pie no longer contains.)
    const positives = r.items.filter((it) => it.signed > 0);
    const total = r.positives || 1;
    const demandShare = positives
      .filter((it) => it.kind !== "kept")
      .reduce((n, it) => n + it.signed / total, 0);
    // Direction to Sky = toward + π. The demand run is the LAST stretch of
    // the pie, so start it so that stretch's centre lands on that direction.
    let a = toward + Math.PI + demandShare * Math.PI;
    const slices: RingSlice[] = positives.map((it) => {
      const span = (it.signed / total) * TWO_PI;
      const a0 = a;
      const a1 = a + span;
      a = a1;
      const mid = (a0 + a1) / 2;
      const midR = (s.r + s.holeR) / 2;
      const amountX = px + midR * Math.cos(mid);
      const amountY = py + midR * Math.sin(mid);
      // A permanent "CoF $7.86M" only where its measured box fits inside
      // the slice; otherwise the hover pill carries it.
      const text = `${SLICE_CODE[it.kind]} ${formatUsd(it.signed, true)}`;
      const fit = fitInSector(px, py, s.r, s.holeR, a0, a1, textWidth(text, FIGURE_FONT, FIGURE_CHAR_PX), FIGURE_H);
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
        figureX: fit?.x ?? null,
        figureY: fit?.y ?? null,
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

    // Two lanes between this Prime and Sky. The To-Sky arrow leaves the
    // pie's edge for the nearest point of the Prime's own wedge; the
    // demand-side arrow comes back the other way. Each is pushed off the
    // centre line by its own half-width so the pair reads as two lanes
    // rather than one arrow drawn over another.
    const range = wedgeRange.get(r.p.prime);
    const skyW = widthOf(Math.abs(r.sky));
    const demandW = widthOf(r.demand);
    const dockAngle = (() => {
      if (!range) return toward;
      const [a0, a1] = range;
      const mid = (a0 + a1) / 2;
      const half = Math.max(0, ((a1 - a0) / 2) * (1 - 2 * DOCK_INSET));
      return mid + Math.max(-half, Math.min(half, angDiff(mid, toward)));
    })();
    /** One lane: `out` runs Prime → Sky, otherwise Sky → Prime. */
    const lane = (out: boolean, w: number, offset: number) => {
      const sx = CX + skyR * Math.cos(out ? dockAngle : toward);
      const sy = cy + skyR * Math.sin(out ? dockAngle : toward);
      const dx = sx - px;
      const dy = sy - py;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      // Perpendicular shift, opposite sides for the two lanes.
      const nx = -uy * offset;
      const ny = ux * offset;
      const pieX = px + ux * (s.r + 2) + nx;
      const pieY = py + uy * (s.r + 2) + ny;
      const skyX = sx + nx;
      const skyY = sy + ny;
      const [x0, y0, x1, y1] = out ? [pieX, pieY, skyX, skyY] : [skyX, skyY, pieX, pieY];
      const amountX = (x0 + x1) / 2;
      const amountY = (y0 + y1) / 2;
      return {
        path: arrowPath(x0, y0, x1, y1, w),
        amountX,
        amountY,
        pillX: amountX - uy * PILL_OFFSET,
        pillY: amountY + ux * PILL_OFFSET,
      };
    };
    let arrow: RingArrow | null = null;
    if (r.sky !== 0 && range) {
      const g = lane(true, skyW, skyW / 2 + LANE_GAP);
      arrow = {
        kind: "sky",
        value: Math.abs(r.sky),
        signed: r.sky,
        cof: r.p.cof,
        sde: r.p.sde,
        dock: dockAngle,
        ...g,
      };
    }
    let demandArrow: RingArrow | null = null;
    if (r.demand >= SETTLEMENT_NEAR_ZERO) {
      const g = lane(false, demandW, -(demandW / 2 + LANE_GAP));
      demandArrow = {
        kind: "demand",
        value: r.demand,
        signed: r.demand,
        cof: 0,
        sde: 0,
        dock: toward,
        ...g,
      };
    }

    // Name outside the pie on the side away from Sky (above for the upper
    // half, below for the lower), with the gross figure always on the line
    // UNDER the name (labelY + SUBLABEL_DY, drawn by the view), so the two
    // read the same way everywhere; the gross pill goes beyond both.
    const above = py <= cy;
    // Above: the pair hangs off the rim, so the FIGURE's baseline (labelY +
    // SUBLABEL_DY) plus its descender is what has to clear the pie. Below:
    // the NAME's baseline clears it by its own size.
    const aboveOff = SUBLABEL_DY + LABEL_GAP;
    const labelY = above ? py - s.r - aboveOff * r.alpha : py + s.r + NAME_SIZE * r.alpha;
    return {
      alpha: r.alpha,
      prime: r.p.prime,
      angle: t,
      cx: px,
      cy: py,
      r: s.r,
      slices,
      hole,
      arrow,
      demandArrow,
      received: r.received,
      labelX: px,
      labelY,
      // Clear of the name + figure pair.
      grossPillX: px,
      grossPillY: above ? labelY - 46 : labelY + SUBLABEL_DY + 40,
      grossAnchorX: px,
      grossAnchorY: above ? labelY - 20 : labelY + SUBLABEL_DY + 8,
    };
  });

  return { ...empty, ...fitViewBox(out, skyR, cy), skyR, skyInnerR, skyWedges, primes: out };
}

/** The bounding box of everything drawn — Sky, every pie, its name and
 *  figure line — plus padding. */
function fitViewBox(primes: RingPrime[], skyR: number, cy: number) {
  let x0 = CX - skyR;
  let x1 = CX + skyR;
  // Sky's name and figure sit above its pie, like a Prime's (see MscRing);
  // the name's own ascent is the last thing above it.
  let y0 = cy - skyR - SKY_LABEL_DY - NAME_SIZE;
  let y1 = cy + skyR;
  for (const p of primes) {
    // A Prime mid-arrival reserves only its alpha's share of the name room.
    x0 = Math.min(x0, p.cx - p.r, p.labelX - NAME_HALF_W * p.alpha);
    x1 = Math.max(x1, p.cx + p.r, p.labelX + NAME_HALF_W * p.alpha);
    // Above the name's baseline: its ascent. Below the figure's baseline,
    // SUBLABEL_DY further down: that figure's descender.
    y0 = Math.min(y0, p.cy - p.r, p.labelY - NAME_SIZE * 0.8 * p.alpha);
    y1 = Math.max(y1, p.cy + p.r, p.labelY + (SUBLABEL_DY + 6) * p.alpha);
  }
  return {
    x: x0 - CROP_PAD,
    y: y0 - CROP_PAD,
    width: x1 - x0 + 2 * CROP_PAD,
    height: y1 - y0 + 2 * CROP_PAD,
  };
}
