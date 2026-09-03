// Orbital-chart geometry for the /radar MSC overview: Sky as a central
// circle and each prime as an outlined circle orbiting it, sized by the
// total funds flowing through it. Flows are ribbons — To-Sky ribbons run
// from a prime's circle to the Sky circle; supply-kept and demand-side are
// short ribbons pointing outward from the prime. Pure math, no DOM — the
// view just maps over prebuilt SVG path strings (settlementSankey.ts
// precedent).
//
// Scales, chosen for the ~5-orders-of-magnitude spread in one month
// (Spark $58M vs Osero $497):
// - Circle RADIUS ∝ total^(1/4), so circle AREA ∝ √total — this is the
//   "area is proportional to the square root of total value" note the key
//   shows; it compresses magnitudes twice as hard as a linear-area circle.
// - Ribbon WIDTH ∝ √|value|, floored so hairline flows stay visible.

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
/** Radius scale: r = R_K · total^(1/4), floored. */
const R_K = 1.15;
const R_MIN = 13;
/** Ribbon width: w = 3 + W_SPAN·√v/√vMax, so the largest flow is ~26px. */
const W_SPAN = 23;
const W_MIN = 3;
/** Outward kept/demand ribbon length; angular offset off the outward radial. */
const STUB_LEN = 34;
/** Callout label columns and collision spacing (small circles only). */
const LABEL_GAP_PX = 15;
/** ~px per character of a 14px label, for the fits-inside-circle test. */
const CHAR_PX = 8.4;

export interface RingFlow {
  kind: "sky" | "kept" | "demand";
  /** Magnitude; the sign lives in `signed` (negative → striped fill). */
  value: number;
  signed: number;
  /** Negative kept/demand flows reverse direction: drawn INTO the prime's
   *  circle instead of pointing outward. */
  inward: boolean;
  path: string;
  /** Anchor for the hover amount pill (ribbon midpoint). */
  amountX: number;
  amountY: number;
}

export interface RingSlice {
  kind: "sky" | "kept" | "demand";
  signed: number;
  path: string;
  /** Anchor for the hover amount pill (slice centroid). */
  amountX: number;
  amountY: number;
}

export interface RingPrime {
  /** Workbook prime key ("spark"). */
  prime: string;
  /** Circle center + radius (area ∝ √ of total funds through the prime). */
  cx: number;
  cy: number;
  r: number;
  /** Angle of the circle center around Sky (radians). */
  angle: number;
  /** Pie slices of the circle: To Sky (CoF + SDE) / supply kept /
   *  demand-side shares of the total, the To-Sky slice facing Sky. */
  slices: RingSlice[];
  /** Near-zero flows already dropped (a demand-only prime has no sky ribbon). */
  flows: RingFlow[];
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
  /** Sky circle radius (same area scale as the primes). */
  skyR: number;
  primes: RingPrime[];
}

/** Radii are capped so the FIXED viewBox always fits — a bigger month must
 *  not resize the chart and make the page below it jump. */
const R_MAX = 70;
const SKY_R_MAX = 84;
// Farthest a circle can sit from center: Sky's radius + the far edge-gap +
// its own radius, plus a modest cushion for the overlap-push pass (kept/
// demand no longer draw outward stubs, so STUB_LEN doesn't belong here).
export const HEIGHT = 2 * (SKY_R_MAX + FAR_GAP + R_MAX + 40);

const radiusOf = (total: number) =>
  Math.min(R_MAX, Math.max(R_MIN, R_K * Math.abs(total) ** 0.25));

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
      return { p, flows, total: flows.reduce((n, f) => n + f.value, 0) };
    })
    .filter((r) => r.flows.length > 0);

  const skyTotal = rows.reduce((n, r) => n + Math.abs(r.p.sky), 0);
  const skyR = Math.min(SKY_R_MAX, radiusOf(skyTotal));
  const maxR = Math.max(R_MIN, ...rows.map((r) => radiusOf(r.total)));
  // FIXED frame: the viewBox never changes with the month, so switching
  // months can't reflow the page below the chart.
  const height = HEIGHT;
  const cy = HEIGHT / 2;

  if (rows.length === 0) return { width: WIDTH, height, cx: CX, cy, skyR, primes: [] };

  const vMax = Math.max(1, ...rows.flatMap((r) => r.flows.map((f) => f.value)));
  const widthOf = (v: number) => Math.max(W_MIN, W_SPAN * Math.sqrt(v) / Math.sqrt(vMax) + 3);

  // Placement: even angular spacing from 12 o'clock, but VARIED orbital
  // distances — alternating a near and a far edge-gap off the Sky circle —
  // so the circles pack rather than sit on one ring. A safety pass pushes a
  // circle outward if it still overlaps a neighbour.
  const dists = rows.map((r, i) => skyR + (i % 2 === 0 ? NEAR_GAP : FAR_GAP) + radiusOf(r.total));
  const angles = rows.map((_, i) => -Math.PI / 2 + (i * 2 * Math.PI) / rows.length);
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < rows.length; i++) {
      for (let j = 0; j < i; j++) {
        const [xi, yi] = [dists[i] * Math.cos(angles[i]), dists[i] * Math.sin(angles[i])];
        const [xj, yj] = [dists[j] * Math.cos(angles[j]), dists[j] * Math.sin(angles[j])];
        const need = radiusOf(rows[i].total) + radiusOf(rows[j].total) + CLEARANCE;
        if (Math.hypot(xi - xj, yi - yj) < need) dists[i] += need - Math.hypot(xi - xj, yi - yj);
      }
    }
  }

  const out: RingPrime[] = rows.map((r, i) => {
    const angle = angles[i];
    const rad = radiusOf(r.total);
    const cxP = CX + dists[i] * Math.cos(angle);
    const cyP = cy + dists[i] * Math.sin(angle);
    // Unit vectors: `out` points away from Sky, `inw` toward it.
    const ox = Math.cos(angle);
    const oy = Math.sin(angle);

    // Only the To-Sky flow keeps a ribbon (prime circle edge → Sky circle
    // edge); supply-kept and demand-side are represented by the pie slices,
    // so their old outward stubs are gone.
    const flows: RingFlow[] = r.flows
      .filter((f) => f.kind === "sky")
      .map((f) => {
        const w = widthOf(f.value);
        const x0 = cxP - ox * rad;
        const y0 = cyP - oy * rad;
        const x1 = CX + ox * skyR;
        const y1 = cy + oy * skyR;
        return { kind: f.kind, value: f.value, signed: f.signed, inward: false,
          path: ribbon(x0, y0, x1, y1, w), amountX: (x0 + x1) / 2, amountY: (y0 + y1) / 2 };
      });

    // Pie slices: shares of the circle's total, the To-Sky slice rotated to
    // face the Sky circle. Absolute values size the slices; a negative slice
    // is striped by the view. Each slice carries a hover-amount anchor at
    // its centroid (kept/demand figures live here now that stubs are gone).
    const toSkyDir = Math.atan2(cy - cyP, CX - cxP);
    const sliceOrder = r.flows;
    let sa = toSkyDir - ((Math.abs(r.p.sky) / r.total) * 2 * Math.PI) / 2;
    // Start half a To-Sky slice before the Sky direction only when there IS
    // a sky flow; otherwise just start at the Sky direction.
    if (Math.abs(r.p.sky) < SETTLEMENT_NEAR_ZERO) sa = toSkyDir;
    const slices: RingSlice[] = [];
    for (const kind of ["sky", "kept", "demand"] as const) {
      const f = sliceOrder.find((x) => x.kind === kind);
      if (!f) continue;
      const theta = (f.value / r.total) * 2 * Math.PI;
      const mid = sa + theta / 2;
      const amountR = theta >= 2 * Math.PI - 1e-6 ? 0 : rad * 0.62;
      slices.push({
        kind,
        signed: f.signed,
        path: slicePath(cxP, cyP, rad, sa, sa + theta),
        amountX: cxP + amountR * Math.cos(mid),
        amountY: cyP + amountR * Math.sin(mid),
      });
      sa += theta;
    }

    const fitsInCircle = labelOf(r.p.prime).length * CHAR_PX + 8 <= 2 * rad;
    // Callouts go to the side the circle actually sits on, so leaders never
    // cross the chart; a circle near the vertical center line gets its label
    // directly above/below itself instead of a long leader to either column.
    const nearCenterX = Math.abs(cxP - CX) < 70;
    const side: "start" | "end" = cxP >= CX ? "start" : "end";
    const colEdge = Math.max(...dists) + maxR + STUB_LEN + 20;
    const colX = side === "start" ? CX + colEdge : CX - colEdge;
    const stackedY = cyP >= cy ? cyP + rad + STUB_LEN + 14 : cyP - rad - STUB_LEN - 10;
    return {
      prime: r.p.prime,
      cx: cxP,
      cy: cyP,
      r: rad,
      angle,
      slices,
      flows,
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

  return { width: WIDTH, height, cx: CX, cy, skyR, primes: out };
}
