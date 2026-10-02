// Paired bootstrap over per-query hit vectors.
//
// Resamples the SAME queries for every arm, so the comparison is within-query:
// an arm that wins only on the queries it happens to be shown is not separated
// from the one it beats. A few points of difference over ~100 queries is worth
// nothing if the resampling distribution straddles zero, so an arm ships only
// when the interval clears it.
export interface PairedResult {
  /** The observed difference, in percentage points of accuracy. */
  point: number;
  /** 95% interval over the resamples, in the same units. */
  lo: number;
  hi: number;
  /** Share of resamples in which `a` scored higher. */
  pBetter: number;
}

/** `trace` holds one record per query: arm name → 1 for a hit, 0 for a miss. */
export function pairedBootstrap(
  trace: readonly Record<string, number>[],
  a: string,
  b: string,
  resamples = 4000,
): PairedResult {
  const n = trace.length;
  const diffs: number[] = [];
  let wins = 0;
  for (let r = 0; r < resamples; r++) {
    let d = 0;
    for (let i = 0; i < n; i++) { const t = trace[(Math.random() * n) | 0]!; d += t[a]! - t[b]!; }
    diffs.push((100 * d) / n);
    if (d > 0) wins++;
  }
  diffs.sort((x, y) => x - y);
  return {
    point: (100 * trace.reduce((s, t) => s + t[a]! - t[b]!, 0)) / n,
    lo: diffs[Math.floor(resamples * 0.025)]!,
    hi: diffs[Math.floor(resamples * 0.975)]!,
    pBetter: wins / resamples,
  };
}

/** One line of report for a pair, as the eval rigs print it. */
export function formatPaired(a: string, b: string, r: PairedResult): string {
  return `${a} − ${b}: ${r.point.toFixed(1)} pts  95% CI [${r.lo.toFixed(1)}, ${r.hi.toFixed(1)}]  P(${a} better)=${r.pBetter.toFixed(2)}`;
}
