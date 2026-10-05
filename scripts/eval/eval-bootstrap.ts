// Paired bootstrap shared by the eval harnesses.
//
// Resample the SAME rows for both arms, so the comparison is within-query. A
// 4-point gap on 98 queries is worth nothing if the resampling distribution
// straddles zero.

/** Small seeded RNG (mulberry32) so tests can pin the resampling. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface BootstrapResult {
  /** Mean of a − b over the rows, in percentage points. */
  point: number;
  lo: number;
  hi: number;
  /** Share of resamples where arm a beat arm b. */
  pBetter: number;
  n: number;
}

export function pairedBootstrap(
  trace: Record<string, number>[],
  a: string,
  b: string,
  opts: { resamples?: number; rng?: () => number } = {},
): BootstrapResult {
  const R = opts.resamples ?? 4000;
  const rng = opts.rng ?? Math.random;
  const n = trace.length;
  const diffs: number[] = [];
  let wins = 0;
  for (let r = 0; r < R; r++) {
    let d = 0;
    for (let i = 0; i < n; i++) {
      const t = trace[(rng() * n) | 0]!;
      d += t[a]! - t[b]!;
    }
    diffs.push((100 * d) / n);
    if (d > 0) wins++;
  }
  diffs.sort((x, y) => x - y);
  const point = (100 * trace.reduce((s, t) => s + t[a]! - t[b]!, 0)) / n;
  return {
    point,
    lo: diffs[Math.floor(R * 0.025)]!,
    hi: diffs[Math.floor(R * 0.975)]!,
    pBetter: wins / R,
    n,
  };
}

export function formatBootstrap(a: string, b: string, r: BootstrapResult): string {
  return (
    `${a} − ${b}: ${r.point.toFixed(1)} pts  95% CI ` +
    `[${r.lo.toFixed(1)}, ${r.hi.toFixed(1)}]  ` +
    `P(${a} better)=${r.pBetter.toFixed(2)}`
  );
}
