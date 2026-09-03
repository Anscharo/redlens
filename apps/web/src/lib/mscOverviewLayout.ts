// Orbital-chart geometry for the /radar MSC overview: Sky as a central
// circle subdivided into one wedge per Prime, and each Prime as an outlined
// circle orbiting it. Pure math, no DOM — the view just maps over prebuilt
// SVG path strings (settlementSankey.ts precedent).
//
// ONE area scale for every circle here: circle AREA is proportional to the
// dollars it stands for (r = k·√v, a single k per month pinned so Sky lands
// on SKY_R). That makes the relationship the chart is really about exact and
// visible — the Sky circle IS the sum of the To-Sky flows feeding it, and
// its wedges show whose money that is.
//
// (This replaced an r ∝ total^(1/4) "area ∝ √value" scale. That compressed
// so hard that Sky's $15.5M looked no bigger than the $9.7M Primes feeding
// it — and it sized a Prime by its total INCLUDING the To-Sky pass-through,
// which is not the Prime's money at all.)
//
// Two deliberately different quantities:
// - A PRIME's circle is its own REVENUE (supply kept + demand-side), which
//   is exactly what its pie divides.
// - SKY's circle is the sum of the To-Sky flows (cost of funds + SDE), which
//   is money passing THROUGH the Primes, not earned by them.
// Ribbon WIDTH is linear in value (widest = W_MAX), floored so a hairline
// flow stays visible; the proportions live in the Sky wedges, so the ribbon
// only has to say "this Prime feeds that wedge".

import { SETTLEMENT_NEAR_ZERO } from "@/lib/settlements";
import type { PrimeFlowTotals } from "@/lib/settlementsOverview";

export const WIDTH = 840;
const CX = WIDTH / 2;
/** Edge gap between the Sky circle and a prime circle — alternating near
 *  and far so circles pack at varied orbital distances. */
const NEAR_GAP = 46;
const FAR_GAP = 104;
/** Minimum clearance between two prime circles. */
const CLEARANCE = 10;
/** Sky renders at this radius; the month's whole area scale derives from it. */
const SKY_R = 92;
/** Floor/cap on a prime circle. The cap only exists so the FIXED viewBox
 *  always fits; on real months the Sky total dwarfs any one prime's revenue
 *  and it never binds. */
const R_MIN = 13;
const R_MAX = 60;
/** Sky's center plate — the label well punched out of the wedges. */
const SKY_LABEL_R = 46;
/** Ribbon width: linear in value, largest flow at W_MAX. */
const W_MAX = 34;
const W_MIN = 3;
/** Smallest Sky wedge, so a hairline contribution ($497 of $15.5M) still
 *  shows and its prime still gets a distinguishable dock point. */
const MIN_WEDGE = 0.05;
/** Leader length from a mark to its hover pill. */
const PILL_OFFSET = 30;
/** Callout label columns and collision spacing (small circles only). */
const LABEL_GAP_PX = 15;
/** Leader length for a stacked/side callout label. */
const CALLOUT_LEN = 34;
/** ~px per character of a 14px label, for the fits-inside-circle test. */
const CHAR_PX = 8.4;

export interface RingFlow {
  kind: "sky";
  /** Magnitude; the sign lives in `signed` (negative → striped fill). */
  value: number;
  signed: number;
  path: string;
  /** Where the pill's leader touches the mark (ribbon midpoint). */
  amountX: number;
  amountY: number;
  /** Where the hover pill sits — off the mark, so it never covers the shape
   *  it names or the prime's own label. */
  pillX: number;
  pillY: number;
}

export interface RingSlice {
  /** Pie slices are revenue only — "sky" never appears here (see RingPrime). */
  kind: "kept" | "demand";
  signed: number;
  path: string;
  /** Where the pill's leader touches the mark (slice centroid). */
  amountX: number;
  amountY: number;
  /** Where the hover pill sits — outside the circle. */
  pillX: number;
  pillY: number;
}

/** A negative kept/demand flow: reported beside the circle instead of as a
 *  pie wedge — a pie's angles have to sum to a real positive whole, so a
 *  loss can't be drawn as one. */
export interface RingLossNote {
  kind: "kept" | "demand";
  /** Always negative. */
  signed: number;
}

/** One prime's share of the Sky circle. The wedges together ARE the Sky
 *  circle, which is the point: every dollar in it arrived from a prime. */
export interface RingSkyWedge {
  prime: string;
  path: string;
  /** Mid-angle of the wedge — where that prime's ribbon docks. */
  mid: number;
  value: number;
}

export interface RingPrime {
  /** Workbook prime key ("spark"). */
  prime: string;
  /** Circle center + radius (area ∝ the prime's own revenue). */
  cx: number;
  cy: number;
  r: number;
  /** Angle of the circle center around Sky (radians). */
  angle: number;
  /** Pie slices of the circle: shares of the prime's own POSITIVE revenue
   *  (supply kept / demand-side only — To Sky is a pass-through, not
   *  revenue, and never gets a wedge). */
  slices: RingSlice[];
  /** The To-Sky ribbon, or empty for a prime that pays Sky nothing. */
  flows: RingFlow[];
  /** Negative kept/demand flows, excluded from the pie above. */
  lossNotes: RingLossNote[];
  /** "circle" = the name fits inside the prime's circle; "callout" = it sits
   *  in a side column, connected by `leaderPath`. */
  labelMode: "circle" | "callout";
  leaderPath: string;
  labelX: number;
  labelY: number;
  labelAnchor: "start" | "end" | "middle";
}

export interface RingLayout {
  width: number;
  height: number;
  cx: number;
  cy: number;
  /** Sky circle radius (area ∝ the To-Sky total, same scale as the primes). */
  skyR: number;
  /** Radius of Sky's center label plate. */
  skyLabelR: number;
  /** Per-prime shares of the Sky circle, in orbital order. */
  skyWedges: RingSkyWedge[];
  primes: RingPrime[];
}

/** FIXED frame: the viewBox never changes with the month, so switching
 *  months can't reflow the page below the chart. */
export const HEIGHT = 2 * (SKY_R + FAR_GAP + R_MAX + 52);

/** Pie slice of a circle from angle a0 to a1 (full circle when it is the
 *  only slice). */
function slicePath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  if (a1 - a0 >= 2 * Math.PI - 1e-6) {
    return (
      `M${cx + r},${cy} A${r},${r} 0 1 1 ${cx - r},${cy} ` +
      `A${r},${r} 0 1 1 ${cx + r},${cy} Z`
    );
  }
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const x0 = cx + r * Math.cos(a0);
  const y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  return `M${cx},${cy} L${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} Z`;
}

/** Straight ribbon of width w between two points (a quad, ends ⟂ to the axis). */
function ribbon(x0: number, y0: number, x1: number, y1: number, w: number): string {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const px = (-dy / len) * (w / 2);
  const py = (dx / len) * (w / 2);
  return `M${x0 + px},${y0 + py} L${x1 + px},${y1 + py} L${x1 - px},${y1 - py} L${x0 - px},${y0 - py} Z`;
}

/** Push a pill PILL_OFFSET away from its mark, along `dir` (falling back to
 *  `alt` when the mark's own direction is degenerate, e.g. a full circle). */
function pillAt(ax: number, ay: number, dx: number, dy: number, altX: number, altY: number) {
  let len = Math.hypot(dx, dy);
  let ux = dx;
  let uy = dy;
  if (len < 1e-6) {
    ux = altX;
    uy = altY;
    len = Math.hypot(ux, uy) || 1;
  }
  return { pillX: ax + (ux / len) * PILL_OFFSET, pillY: ay + (uy / len) * PILL_OFFSET };
}

const FLOW_KINDS = ["kept", "sky", "demand"] as const;

export function layoutMscRing(
  primes: readonly PrimeFlowTotals[],
  labelOf: (prime: string) => string = (p) => p,
): RingLayout {
  const rows = primes
    .map((p) => {
      const flows = FLOW_KINDS.map((k) => ({ kind: k, signed: p[k], value: Math.abs(p[k]) })).filter(
        (f) => f.value >= SETTLEMENT_NEAR_ZERO,
      );
      // The prime's own money — what its pie divides and its circle sizes.
      const revenue = flows
        .filter((f) => f.kind !== "sky" && f.signed > 0)
        .reduce((n, f) => n + f.signed, 0);
      return { p, flows, revenue };
    })
    .filter((r) => r.flows.length > 0);

  const skyTotal = rows.reduce((n, r) => n + Math.abs(r.p.sky), 0);
  // One area-per-dollar scale for the whole chart, pinned to Sky. (If a month
  // ever had no To-Sky flow at all, fall back to the largest prime so the
  // chart still fills its frame.)
  const ref =
    skyTotal >= SETTLEMENT_NEAR_ZERO ? skyTotal : Math.max(1, ...rows.map((r) => r.revenue));
  const k = SKY_R / Math.sqrt(ref);
  const radiusOf = (v: number) => Math.min(R_MAX, Math.max(R_MIN, k * Math.sqrt(Math.max(0, v))));
  const skyR = Math.min(SKY_R, Math.max(R_MIN, k * Math.sqrt(skyTotal)));
  const cy = HEIGHT / 2;
  const height = HEIGHT;

  if (rows.length === 0) {
    return { width: WIDTH, height, cx: CX, cy, skyR, skyLabelR: SKY_LABEL_R, skyWedges: [], primes: [] };
  }

  const maxSky = Math.max(1, ...rows.map((r) => Math.abs(r.p.sky)));
  const widthOf = (v: number) => Math.max(W_MIN, (W_MAX * v) / maxSky);

  // Placement: even angular spacing from 12 o'clock, but VARIED orbital
  // distances — alternating a near and a far edge-gap off the Sky circle —
  // so the circles pack rather than sit on one ring. A safety pass pushes a
  // circle outward if it still overlaps a neighbour.
  const radii = rows.map((row) => radiusOf(row.revenue));
  const dists = rows.map((_, i) => skyR + (i % 2 === 0 ? NEAR_GAP : FAR_GAP) + radii[i]);
  const angles = rows.map((_, i) => -Math.PI / 2 + (i * 2 * Math.PI) / rows.length);
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < rows.length; i++) {
      for (let j = 0; j < i; j++) {
        const [xi, yi] = [dists[i] * Math.cos(angles[i]), dists[i] * Math.sin(angles[i])];
        const [xj, yj] = [dists[j] * Math.cos(angles[j]), dists[j] * Math.sin(angles[j])];
        const need = radii[i] + radii[j] + CLEARANCE;
        if (Math.hypot(xi - xj, yi - yj) < need) dists[i] += need - Math.hypot(xi - xj, yi - yj);
      }
    }
  }
  const maxR = Math.max(R_MIN, ...radii);

  // Sky's wedges: each contributing prime's share of the To-Sky total, laid
  // out in orbital order so ribbons stay roughly radial, and anchored on the
  // BIGGEST contributor (rows are magnitude-desc) so its ribbon runs straight
  // in. Together the wedges are the whole circle — that is the claim the
  // chart makes: Sky is exactly the sum of what the Primes sent it.
  const contributors = rows
    .map((r, i) => ({ r, i }))
    .filter((x) => Math.abs(x.r.p.sky) >= SETTLEMENT_NEAR_ZERO);
  const floorShare = MIN_WEDGE / (2 * Math.PI);
  const shares = contributors.map((x) => Math.max(Math.abs(x.r.p.sky) / skyTotal, floorShare));
  const shareSum = shares.reduce((n, s) => n + s, 0) || 1;
  const spans = shares.map((s) => (s / shareSum) * 2 * Math.PI);
  let wa = contributors.length > 0 ? angles[contributors[0].i] - spans[0] / 2 : -Math.PI / 2;
  const skyWedges: RingSkyWedge[] = contributors.map((x, j) => {
    const a0 = wa;
    const a1 = wa + spans[j];
    wa = a1;
    return {
      prime: x.r.p.prime,
      path: slicePath(CX, cy, skyR, a0, a1),
      mid: (a0 + a1) / 2,
      value: Math.abs(x.r.p.sky),
    };
  });
  const dockOf = new Map(skyWedges.map((w) => [w.prime, w.mid]));

  const out: RingPrime[] = rows.map((r, i) => {
    const angle = angles[i];
    const rad = radii[i];
    const cxP = CX + dists[i] * Math.cos(angle);
    const cyP = cy + dists[i] * Math.sin(angle);
    // Unit vector pointing away from Sky, for label/pill fallbacks.
    const ox = Math.cos(angle);
    const oy = Math.sin(angle);

    // The To-Sky ribbon runs from the prime's circle edge to the middle of
    // that prime's own wedge on the Sky circle.
    const skyFlow = r.flows.find((f) => f.kind === "sky");
    const dock = dockOf.get(r.p.prime);
    const flows: RingFlow[] = [];
    if (skyFlow && dock != null) {
      const x1 = CX + skyR * Math.cos(dock);
      const y1 = cy + skyR * Math.sin(dock);
      const dx = x1 - cxP;
      const dy = y1 - cyP;
      const len = Math.hypot(dx, dy) || 1;
      const x0 = cxP + (dx / len) * rad;
      const y0 = cyP + (dy / len) * rad;
      const amountX = (x0 + x1) / 2;
      const amountY = (y0 + y1) / 2;
      flows.push({
        kind: "sky",
        value: skyFlow.value,
        signed: skyFlow.signed,
        path: ribbon(x0, y0, x1, y1, widthOf(skyFlow.value)),
        amountX,
        amountY,
        // Off to the side of the ribbon (perpendicular), never on top of it.
        ...pillAt(amountX, amountY, -dy / len, dx / len, ox, oy),
      });
    }

    // Pie slices: the prime's own REVENUE only — supply kept + demand-side.
    // To-Sky is a pass-through, never the prime's revenue, so it never gets a
    // wedge here. A negative kept/demand can't be a wedge either (pie angles
    // have to sum to a real positive whole); it becomes a loss note.
    const revenueFlows = r.flows.filter((f) => f.kind !== "sky" && f.signed > 0);
    const lossNotes: RingLossNote[] = r.flows
      .filter((f) => f.kind !== "sky" && f.signed < 0)
      .map((f) => ({ kind: f.kind as "kept" | "demand", signed: f.signed }));
    const slices: RingSlice[] = [];
    let sa = -Math.PI / 2;
    if (r.revenue >= SETTLEMENT_NEAR_ZERO) {
      for (const kind of ["kept", "demand"] as const) {
        const f = revenueFlows.find((x) => x.kind === kind);
        if (!f) continue;
        const theta = (f.signed / r.revenue) * 2 * Math.PI;
        const mid = sa + theta / 2;
        const amountR = theta >= 2 * Math.PI - 1e-6 ? 0 : rad * 0.62;
        const amountX = cxP + amountR * Math.cos(mid);
        const amountY = cyP + amountR * Math.sin(mid);
        slices.push({
          kind,
          signed: f.signed,
          path: slicePath(cxP, cyP, rad, sa, sa + theta),
          amountX,
          amountY,
          // Straight out from the prime's center, so the pill clears the
          // circle (and the name inside it) whatever the slice's size.
          ...pillAt(amountX, amountY, amountX - cxP, amountY - cyP, ox, oy),
        });
        sa += theta;
      }
    }

    const fitsInCircle = labelOf(r.p.prime).length * CHAR_PX + 8 <= 2 * rad;
    // Callouts go to the side the circle actually sits on, so leaders never
    // cross the chart; a circle near the vertical center line gets its label
    // directly above/below itself instead of a long leader to either column.
    const nearCenterX = Math.abs(cxP - CX) < 70;
    const side: "start" | "end" = cxP >= CX ? "start" : "end";
    const colEdge = Math.max(...dists) + maxR + CALLOUT_LEN + 20;
    const colX = side === "start" ? CX + colEdge : CX - colEdge;
    const stackedY = cyP >= cy ? cyP + rad + CALLOUT_LEN + 14 : cyP - rad - CALLOUT_LEN - 10;
    return {
      prime: r.p.prime,
      cx: cxP,
      cy: cyP,
      r: rad,
      angle,
      slices,
      flows,
      lossNotes,
      labelMode: fitsInCircle ? ("circle" as const) : ("callout" as const),
      leaderPath: "", // callouts: filled after the collision pass below
      labelX: fitsInCircle || nearCenterX ? cxP : colX,
      labelY: fitsInCircle ? cyP : nearCenterX ? stackedY : cyP,
      labelAnchor: fitsInCircle || nearCenterX ? ("middle" as const) : side,
    };
  });

  // Callout collision pass, per side; then draw each leader from the circle's
  // outer edge to wherever its label ended up.
  for (const anchor of ["start", "end"] as const) {
    const sideLabels = out
      .filter((p) => p.labelMode === "callout" && p.labelAnchor === anchor)
      .sort((x, y) => x.labelY - y.labelY);
    let prevY = -Infinity;
    for (const p of sideLabels) {
      p.labelY = Math.max(p.labelY, prevY + LABEL_GAP_PX);
      prevY = p.labelY;
    }
  }
  for (const p of out) {
    if (p.labelMode !== "callout") continue;
    if (p.labelAnchor === "middle") {
      // Stacked above/below its circle: a short vertical leader.
      const below = p.labelY > p.cy;
      p.leaderPath = `M${p.cx},${p.cy + (below ? p.r + 2 : -p.r - 2)} L${p.cx},${p.labelY + (below ? -10 : 6)}`;
      continue;
    }
    const ax = p.cx + Math.cos(p.angle) * (p.r + 2);
    const ay = p.cy + Math.sin(p.angle) * (p.r + 2);
    const endX = p.labelAnchor === "start" ? p.labelX - 6 : p.labelX + 6;
    p.leaderPath = `M${ax},${ay} L${endX},${p.labelY}`;
  }

  return { width: WIDTH, height, cx: CX, cy, skyR, skyLabelR: SKY_LABEL_R, skyWedges, primes: out };
}
