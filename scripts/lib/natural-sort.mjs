// Locale-independent sort comparators.
//
// `localeCompare` (with or without `{ numeric: true }`) resolves through the
// host's ICU collation tables, which differ across OS/Node builds — the same
// input can sort differently on a dev machine vs CI, which `REPRO=1 pnpm test`
// (same-machine, same-run) can't catch but a cross-environment rebuild will.
// These comparators are pure code-unit comparisons (byte-stable everywhere
// Node runs) that reproduce the two ordering intents the codebase relies on.

/** Plain code-unit string comparator — stable replacement for bare `localeCompare`. */
export function codeUnitCompare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Locale-independent "natural" comparator — reproduces `localeCompare(b, undefined,
 * { numeric: true })` ordering (e.g. "A.2.9" before "A.2.10") by splitting each
 * string into alternating digit/non-digit runs and comparing digit runs
 * numerically, non-digit runs by code unit.
 */
export function naturalCompare(a, b) {
  const re = /(\d+|\D+)/g;
  const aParts = a.match(re) ?? [];
  const bParts = b.match(re) ?? [];
  const len = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < len; i++) {
    const ap = aParts[i];
    const bp = bParts[i];
    if (ap === undefined) return -1;
    if (bp === undefined) return 1;
    const aIsNum = /^\d+$/.test(ap);
    const bIsNum = /^\d+$/.test(bp);
    if (aIsNum && bIsNum) {
      const an = BigInt(ap);
      const bn = BigInt(bp);
      if (an !== bn) return an < bn ? -1 : 1;
      // Equal numeric value but different digit strings (e.g. "01" vs "1") —
      // fall back to code-unit comparison for determinism.
      if (ap !== bp) return codeUnitCompare(ap, bp);
    } else {
      const c = codeUnitCompare(ap, bp);
      if (c !== 0) return c;
    }
  }
  return 0;
}
