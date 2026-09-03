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
/** Orbit radius for prime circle centers. */
const ORBIT = 212;
/** Radius scale: r = R_K · total^(1/4), floored. */
const R_K = 1.15;
const R_MIN = 13;
/** Ribbon width: w = 3 + W_SPAN·√v/√vMax, so the largest flow is ~26px. */
const W_SPAN = 23;
const W_MIN = 3;
/** Outward kept/demand ribbon length; angular offset off the outward radial. */
const STUB_LEN = 34;
const STUB_SPREAD = 0.55;
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

export interface RingPrime {
  /** Workbook prime key ("spark"). */
  prime: string;
  /** Circle center + radius (area ∝ √ of total funds through the prime). */
  cx: number;
  cy: number;
  r: number;
  /** Angle of the circle center around Sky (radians). */
  angle: number;
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

const radiusOf = (total: number) => Math.max(R_MIN, R_K * Math.abs(total) ** 0.25);

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
  const skyR = radiusOf(skyTotal);
  const maxR = Math.max(R_MIN, ...rows.map((r) => radiusOf(r.total)));
  // The tallest thing hanging off a circle is its outward ribbon + label room.
  const extent = ORBIT + maxR + STUB_LEN + 34;
  const height = 2 * extent;
  const cy = extent;

  if (rows.length === 0) return { width: WIDTH, height: 520, cx: CX, cy: 260, skyR, primes: [] };

  const vMax = Math.max(1, ...rows.flatMap((r) => r.flows.map((f) => f.value)));
  const widthOf = (v: number) => Math.max(W_MIN, W_SPAN * Math.sqrt(v) / Math.sqrt(vMax) + 3);

  // Angular placement: each circle needs an arc footprint for its radius;
  // the leftover becomes even gaps. Deterministic, starts at 12 o'clock.
  const footprints = rows.map((r) => 2 * Math.asin(Math.min(0.95, (radiusOf(r.total) + 10) / ORBIT)));
  const leftover = Math.max(0, 2 * Math.PI - footprints.reduce((a, b) => a + b, 0));
  const gap = leftover / rows.length;
  let a = -Math.PI / 2;

  const out: RingPrime[] = rows.map((r, i) => {
    const angle = a + footprints[i] / 2;
    a += footprints[i] + gap;
    const rad = radiusOf(r.total);
    const cxP = CX + ORBIT * Math.cos(angle);
    const cyP = cy + ORBIT * Math.sin(angle);
    // Unit vectors: `out` points away from Sky, `inw` toward it.
    const ox = Math.cos(angle);
    const oy = Math.sin(angle);

    const flows: RingFlow[] = r.flows.map((f) => {
      const w = widthOf(f.value);
      if (f.kind === "sky") {
        // Ribbon between the two circle edges, along the center line.
        const x0 = cxP - ox * rad;
        const y0 = cyP - oy * rad;
        const x1 = CX + ox * skyR;
        const y1 = cy + oy * skyR;
        return { kind: f.kind, value: f.value, signed: f.signed, inward: false,
          path: ribbon(x0, y0, x1, y1, w), amountX: (x0 + x1) / 2, amountY: (y0 + y1) / 2 };
      }
      // Kept/demand leave the circle outward, spread to either side of the
      // radial; a negative flow reverses INTO the circle (striped by the view).
      const dirA = angle + (f.kind === "kept" ? -STUB_SPREAD : STUB_SPREAD);
      const dx = Math.cos(dirA);
      const dy = Math.sin(dirA);
      const inward = f.signed < 0;
      const ex = cxP + dx * rad;
      const ey = cyP + dy * rad;
      const len = inward ? Math.min(STUB_LEN, 2 * rad - 4) : STUB_LEN;
      const tx = ex + (inward ? -dx : dx) * len;
      const ty = ey + (inward ? -dy : dy) * len;
      return { kind: f.kind, value: f.value, signed: f.signed, inward,
        path: ribbon(ex, ey, tx, ty, w), amountX: (ex + tx) / 2, amountY: (ey + ty) / 2 };
    });

    const fitsInCircle = labelOf(r.p.prime).length * CHAR_PX + 8 <= 2 * rad;
    const side: "start" | "end" = Math.cos(angle) >= 0 ? "start" : "end";
    const colX = side === "start" ? CX + ORBIT + maxR + STUB_LEN + 20 : CX - ORBIT - maxR - STUB_LEN - 20;
    return {
      prime: r.p.prime,
      cx: cxP,
      cy: cyP,
      r: rad,
      angle,
      flows,
      labelMode: fitsInCircle ? ("circle" as const) : ("callout" as const),
      leaderPath: "", // callouts: filled after the collision pass below
      labelX: fitsInCircle ? cxP : colX,
      labelY: fitsInCircle ? cyP : cyP,
      labelAnchor: fitsInCircle ? ("middle" as const) : side,
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
    const ax = p.cx + Math.cos(p.angle) * (p.r + 2);
    const ay = p.cy + Math.sin(p.angle) * (p.r + 2);
    const endX = p.labelAnchor === "start" ? p.labelX - 6 : p.labelX + 6;
    p.leaderPath = `M${ax},${ay} L${endX},${p.labelY}`;
  }

  return { width: WIDTH, height, cx: CX, cy, skyR, primes: out };
}
