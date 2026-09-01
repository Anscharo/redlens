// Circular-sankey geometry for the /radar MSC overview: Sky as a central
// disc, primes as arc wedges orbiting it, To-Sky ribbons docking inward and
// supply-kept / demand-side stubs pointing outward. Pure math, no DOM — the
// view just maps over prebuilt SVG path strings (settlementSankey.ts
// precedent).
//
// Wedge ANGLE is the only magnitude encoding, on a sqrt scale: the data
// spans ~5 orders of magnitude in one month (Spark $58M to Sky vs Osero
// $497), so linear angles would leave every prime but two invisible, and a
// variable stub length would double-encode the same number.

import { SETTLEMENT_NEAR_ZERO } from "@/lib/settlements";
import type { PrimeFlowTotals } from "@/lib/settlementsOverview";

export const SIZE = 640;
const CX = SIZE / 2;
const CY = SIZE / 2;
/** Central Sky disc; To-Sky ribbons dock on its perimeter. */
export const R_SKY = 70;
/** Prime band annulus [R_IN, R_OUT]; ribbons leave R_IN inward, stubs R_OUT outward. */
const R_IN = 208;
const ARC_T = 14;
const R_OUT = R_IN + ARC_T;
/** Fixed radial stub length — see the angle-only-encoding note above. */
const STUB_LEN = 28;
const R_LABEL = R_OUT + STUB_LEN + 14;
/** Angular gap between primes. */
const GAP = 0.1;
/** Floors keeping the smallest prime/flow visible and hoverable. */
const MIN_PRIME_ANGLE = 0.12;
const MIN_FLOW_ANGLE = 0.035;

export interface RingFlow {
  kind: "sky" | "kept" | "demand";
  /** Magnitude; the sign lives in `signed` (negative → loss styling). */
  value: number;
  signed: number;
  path: string;
  a0: number;
  a1: number;
  /** Anchor for the hover amount text (flow midpoint). */
  amountX: number;
  amountY: number;
}

export interface RingPrime {
  /** Workbook prime key ("spark"). */
  prime: string;
  a0: number;
  a1: number;
  mid: number;
  /** The prime's band segment on the outer ring. */
  arcPath: string;
  /** Near-zero flows already dropped (a demand-only prime has no sky ribbon). */
  flows: RingFlow[];
  labelX: number;
  labelY: number;
  labelAnchor: "start" | "middle" | "end";
}

export interface RingLayout {
  size: number;
  cx: number;
  cy: number;
  skyR: number;
  primes: RingPrime[];
}

const pt = (r: number, a: number): [number, number] => [CX + r * Math.cos(a), CY + r * Math.sin(a)];

/** Annular sector from rOuter down to rInner over [a0, a1]. With GAP > 0 no
 *  wedge ever reaches π, so the large-arc flag is always 0. */
function sector(rOuter: number, rInner: number, a0: number, a1: number): string {
  const [x0, y0] = pt(rOuter, a0);
  const [x1, y1] = pt(rOuter, a1);
  const [x2, y2] = pt(rInner, a1);
  const [x3, y3] = pt(rInner, a0);
  return (
    `M${x0},${y0} A${rOuter},${rOuter} 0 0 1 ${x1},${y1} ` +
    `L${x2},${y2} A${rInner},${rInner} 0 0 0 ${x3},${y3} Z`
  );
}

/**
 * Split `total` proportionally to `weights`, clamping every positive-weight
 * share up to `min` and renormalizing the rest; zero weights get zero.
 * Converges in ≤ n passes. If the floors alone exceed the budget (cannot
 * happen at today's prime counts: 8·(0.12+0.10) < 2π) everything degrades
 * to an equal split rather than overflowing the circle.
 */
function allocate(weights: readonly number[], total: number, min: number): number[] {
  const active = weights.map((w) => w > 0);
  const n = active.filter(Boolean).length;
  if (n === 0) return weights.map(() => 0);
  if (n * min >= total) return weights.map((w) => (w > 0 ? total / n : 0));
  const out = weights.map(() => 0);
  const floored = weights.map(() => false);
  for (let pass = 0; pass < weights.length; pass++) {
    const budget = total - min * floored.filter(Boolean).length;
    const freeSum = weights.reduce((t, w, i) => (active[i] && !floored[i] ? t + w : t), 0);
    let clampedMore = false;
    for (let i = 0; i < weights.length; i++) {
      if (!active[i]) continue;
      if (floored[i]) {
        out[i] = min;
        continue;
      }
      out[i] = (weights[i] / freeSum) * budget;
      if (out[i] < min) {
        floored[i] = true;
        clampedMore = true;
      }
    }
    if (!clampedMore) break;
  }
  return out;
}

const FLOW_KINDS = ["kept", "sky", "demand"] as const;

export function layoutMscRing(primes: readonly PrimeFlowTotals[]): RingLayout {
  // sqrt weights; near-zero flows carry no angle (and later no path).
  const weightsOf = (p: PrimeFlowTotals) =>
    FLOW_KINDS.map((k) => {
      const v = p[k];
      return Math.abs(v) < SETTLEMENT_NEAR_ZERO ? 0 : Math.sqrt(Math.abs(v));
    });
  const rows = primes
    .map((p) => ({ p, flowW: weightsOf(p) }))
    .filter((r) => r.flowW.some((w) => w > 0));

  if (rows.length === 0) return { size: SIZE, cx: CX, cy: CY, skyR: R_SKY, primes: [] };

  const budget = 2 * Math.PI - rows.length * GAP;
  const primeAngles = allocate(
    rows.map((r) => r.flowW.reduce((t, w) => t + w, 0)),
    budget,
    MIN_PRIME_ANGLE,
  );

  // Start at 12 o'clock, clockwise (screen coords: y down, angle increasing).
  let a = -Math.PI / 2;
  const out: RingPrime[] = rows.map((r, i) => {
    const a0 = a;
    const a1 = a0 + primeAngles[i];
    a = a1 + GAP;
    const mid = (a0 + a1) / 2;

    // Fixed flow order [kept, sky, demand]: sky sits in the middle of the
    // wedge so its ribbon points cleanly at the disc.
    const flowAngles = allocate(r.flowW, a1 - a0, MIN_FLOW_ANGLE);
    let fa = a0;
    const flows: RingFlow[] = [];
    FLOW_KINDS.forEach((kind, j) => {
      const theta = flowAngles[j];
      if (theta <= 0) return;
      const s0 = fa;
      const s1 = fa + theta;
      fa = s1;
      const signed = r.p[kind];
      const isSky = kind === "sky";
      // To-Sky ribbon reuses the flow's angular interval at both R_IN and
      // R_SKY — sqrt-proportional widths at both ends, zero crossings. Stubs
      // are plain annular sectors outward from the band.
      const path = isSky
        ? sector(R_IN, R_SKY, s0, s1)
        : sector(R_OUT + STUB_LEN, R_OUT, s0, s1);
      const amountR = isSky ? (R_IN + R_SKY) / 2 : R_OUT + STUB_LEN / 2;
      const [amountX, amountY] = pt(amountR, (s0 + s1) / 2);
      flows.push({ kind, value: Math.abs(signed), signed, path, a0: s0, a1: s1, amountX, amountY });
    });

    const [labelX, rawLabelY] = pt(R_LABEL, mid);
    const cos = Math.cos(mid);
    return {
      prime: r.p.prime,
      a0,
      a1,
      mid,
      arcPath: sector(R_OUT, R_IN, a0, a1),
      flows,
      labelX,
      // Nudge top/bottom labels along the radial direction so they clear the stubs.
      labelY: rawLabelY + Math.sin(mid) * 4,
      labelAnchor: cos > 0.15 ? "start" : cos < -0.15 ? "end" : "middle",
    };
  });

  return { size: SIZE, cx: CX, cy: CY, skyR: R_SKY, primes: out };
}
