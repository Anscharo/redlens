// Circular-sankey geometry for the /radar MSC overview: Sky as a central
// disc, primes as arc wedges orbiting it, To-Sky ribbons docking inward and
// supply-kept / demand-side stubs pointing outward, with callout labels off
// to the sides connected by leader lines. Pure math, no DOM — the view just
// maps over prebuilt SVG path strings (settlementSankey.ts precedent).
//
// Wedge ANGLE is the only magnitude encoding, on a sqrt scale: the data
// spans ~5 orders of magnitude in one month (Spark $58M to Sky vs Osero
// $497), so linear angles would leave every prime but two invisible, and a
// variable stub length would double-encode the same number.

import { SETTLEMENT_NEAR_ZERO } from "@/lib/settlements";
import type { PrimeFlowTotals } from "@/lib/settlementsOverview";

// The viewBox is wider than tall so the side label columns fit inside it —
// text that overflowed the box would collide with the timeseries sitting to
// the ring's left in the overview row. Its height hugs the drawn content
// (max radius R_OUT + STUB_LEN = 250 plus a few px of label overshoot) so
// the key rendered under the svg sits right below the chart's visual
// bottom instead of below empty viewBox padding.
export const WIDTH = 840;
export const HEIGHT = 520;
const CX = WIDTH / 2;
const CY = HEIGHT / 2;
/** Central Sky disc; To-Sky ribbons dock on its perimeter. */
export const R_SKY = 70;
/** Prime band annulus [R_IN, R_OUT]; ribbons leave R_IN inward, stubs R_OUT
 *  outward. The band is deliberately thick enough for a prime NAME to sit
 *  inside it (space taken from the To-Sky ribbon run, R_SKY..R_IN). */
const R_IN = 184;
const ARC_T = 38;
const R_OUT = R_IN + ARC_T;
const R_BAND = R_IN + ARC_T / 2;
/** ~px per character of an 11px band label, for the fits-inside test. */
const BAND_CHAR_PX = 6.6;
const BAND_LABEL_PAD = 12;
/** Fixed radial stub length — see the angle-only-encoding note above. */
const STUB_LEN = 28;
/** Leader line: starts just past the stubs, runs radially to the elbow,
 *  then bends to the label column. */
const R_LEADER_START = R_OUT + STUB_LEN + 3;
const R_ELBOW = R_OUT + STUB_LEN + 16;
/** Fixed label columns left/right of the ring, so callouts align. */
const LABEL_COL_X = R_OUT + STUB_LEN + 34;
/** Minimum vertical separation between labels on one side. */
const LABEL_GAP_PX = 15;
/** Angular gap between primes — wide enough to read as a divider. */
const GAP = 0.16;
/** Small gap between a prime's own flow slices, so kept|sky|demand read as
 *  distinct bars while the band arc above still groups them as one prime. */
const FLOW_GAP = 0.012;
/** Floors keeping the smallest prime/flow visible and hoverable. The prime
 *  floor must fit three flow floors plus two FLOW_GAPs (3·0.035 + 2·0.012). */
const MIN_PRIME_ANGLE = 0.14;
const MIN_FLOW_ANGLE = 0.035;

export interface RingFlow {
  kind: "sky" | "kept" | "demand";
  /** Magnitude; the sign lives in `signed` (negative → striped fill). */
  value: number;
  signed: number;
  /** Negative kept/demand flows reverse direction: drawn INTO the prime's
   *  band (outer edge to inner edge) instead of the outward stub. */
  inward: boolean;
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
  /** "band" = the name fits inside the prime's band segment; "callout" = it
   *  sits in a side column, connected by `leaderPath`. */
  labelMode: "band" | "callout";
  /** Callout leader from the wedge to the label; empty in band mode. */
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
  skyR: number;
  primes: RingPrime[];
  /** Radial hairlines in the inter-prime gaps (divider ticks). */
  dividers: Array<{ x1: number; y1: number; x2: number; y2: number }>;
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
 * happen at today's prime counts: 8·(0.14+0.16) < 2π) everything degrades
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

export function layoutMscRing(
  primes: readonly PrimeFlowTotals[],
  labelOf: (prime: string) => string = (p) => p,
): RingLayout {
  const empty: RingLayout = { width: WIDTH, height: HEIGHT, cx: CX, cy: CY, skyR: R_SKY, primes: [], dividers: [] };
  // sqrt weights; near-zero flows carry no angle (and later no path).
  const weightsOf = (p: PrimeFlowTotals) =>
    FLOW_KINDS.map((k) => {
      const v = p[k];
      return Math.abs(v) < SETTLEMENT_NEAR_ZERO ? 0 : Math.sqrt(Math.abs(v));
    });
  const rows = primes
    .map((p) => ({ p, flowW: weightsOf(p) }))
    .filter((r) => r.flowW.some((w) => w > 0));

  if (rows.length === 0) return empty;

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
    // wedge so its ribbon points cleanly at the disc. FLOW_GAP separates the
    // slices so they read as distinct bars within the prime's band.
    const activeFlows = r.flowW.filter((w) => w > 0).length;
    const flowBudget = a1 - a0 - Math.max(0, activeFlows - 1) * FLOW_GAP;
    const flowAngles = allocate(r.flowW, flowBudget, MIN_FLOW_ANGLE);
    let fa = a0;
    const flows: RingFlow[] = [];
    FLOW_KINDS.forEach((kind, j) => {
      const theta = flowAngles[j];
      if (theta <= 0) return;
      const s0 = fa;
      const s1 = fa + theta;
      fa = s1 + FLOW_GAP;
      const signed = r.p[kind];
      const isSky = kind === "sky";
      // A negative kept/demand flow keeps its category color but reverses
      // direction: instead of pointing outward it is drawn into the band,
      // from its outer edge to its inner edge (the view adds stripes).
      const inward = signed < 0 && !isSky;
      // To-Sky ribbon reuses the flow's angular interval at both R_IN and
      // R_SKY — sqrt-proportional widths at both ends, zero crossings. Stubs
      // are plain annular sectors outward from the band.
      const path = isSky
        ? sector(R_IN, R_SKY, s0, s1)
        : inward
          ? sector(R_OUT, R_IN, s0, s1)
          : sector(R_OUT + STUB_LEN, R_OUT, s0, s1);
      const amountR = isSky ? (R_IN + R_SKY) / 2 : inward ? R_BAND : R_OUT + STUB_LEN / 2;
      const [amountX, amountY] = pt(amountR, (s0 + s1) / 2);
      flows.push({ kind, value: Math.abs(signed), signed, inward, path, a0: s0, a1: s1, amountX, amountY });
    });

    // The name goes INSIDE the band when its estimated width fits the band
    // arc at this wedge's angle; otherwise it becomes a side callout.
    const fitsInBand =
      labelOf(r.p.prime).length * BAND_CHAR_PX + BAND_LABEL_PAD <= (a1 - a0) * R_BAND;
    const side: "start" | "end" = Math.cos(mid) >= 0 ? "start" : "end";
    const [bandX, bandY] = pt(R_BAND, mid);
    return {
      prime: r.p.prime,
      a0,
      a1,
      mid,
      arcPath: sector(R_OUT, R_IN, a0, a1),
      flows,
      labelMode: fitsInBand ? ("band" as const) : ("callout" as const),
      leaderPath: "", // callouts: filled after the collision pass below
      labelX: fitsInBand ? bandX : side === "start" ? CX + LABEL_COL_X : CX - LABEL_COL_X,
      labelY: fitsInBand ? bandY : pt(R_ELBOW, mid)[1],
      labelAnchor: fitsInBand ? ("middle" as const) : side,
    };
  });

  // Callout collision pass, per side: sort by y, push labels down to a
  // minimum separation (same idea as settlementSankey's labelY push), then
  // draw each leader to wherever its label ended up.
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
    const [ax, ay] = pt(R_LEADER_START, p.mid);
    const [bx, by] = pt(R_ELBOW, p.mid);
    const cxEnd = p.labelAnchor === "start" ? p.labelX - 6 : p.labelX + 6;
    p.leaderPath = `M${ax},${ay} L${bx},${by} L${cxEnd},${p.labelY}`;
  }

  // Divider ticks: one radial hairline in the middle of each inter-prime gap
  // (including the wrap-around gap back to the first prime).
  const dividers = out.map((p, i) => {
    const next = out[(i + 1) % out.length];
    const gapMid = i === out.length - 1 ? p.a1 + GAP / 2 : (p.a1 + next.a0) / 2;
    const [x1, y1] = pt(R_SKY + 12, gapMid);
    const [x2, y2] = pt(R_OUT + STUB_LEN, gapMid);
    return { x1, y1, x2, y2 };
  });

  return { width: WIDTH, height: HEIGHT, cx: CX, cy: CY, skyR: R_SKY, primes: out, dividers };
}
