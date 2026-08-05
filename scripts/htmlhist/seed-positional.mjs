// Seed tier S2 — positional threading of the docs the shingle seed CANNOT see.
//
// The #117 seed (seedFromMd in history-html-era.mjs) is the one cross-format hop, and
// it matches on 8-word shingles. A document whose whole body is one word — "`Completed`",
// the ICD parameter leaves under every agent artifact — produces NO shingles, and the
// HTML rows carrying that same word are skipped outright (`if (!rSh.length) continue`).
// Those documents are invisible to the seed: it can neither match nor rule out a
// predecessor for them, and they used to fall through as `created` ("born at the
// migration") even though their predecessor sits right there in the last HTML commit.
//
// Plan §4.2 already solves this shape for the intra-era hops (tier 2.5): when content
// can't separate a bucket of near-identical siblings, ALIGN THEM BY ORDER — the atlas
// preserves row order, so the k-th older is the k-th newer. This module applies the
// same idea across the seam, anchored to the pairs the shingle pass did establish.
//
// Precision rules — this pass only ever ADDS pairings, it never revises one:
//  · it considers ONLY zero-shingle md docs × zero-shingle html rows, a set disjoint by
//    construction from everything the shingle pass touched, so `kept`/`split`/`merged`
//    and every committed curation decision come out unchanged;
//  · a pairing must sit inside the SAME GAP between two consecutive anchors, so it is
//    always bracketed by two independently-matched documents (the anchor spine is the
//    longest order-consistent subsequence of the shingle pairs, so the gaps are real
//    intervals on both sides, not an artifact of a few out-of-order matches);
//  · the two sides must agree on title (and, in the first pass, on body), and the gap
//    must hold the SAME NUMBER of each — an unequal bucket is genuinely ambiguous, so
//    it is left untraced rather than guessed.

/** Longest strictly-increasing subsequence of `rows` (patience sorting, O(n log n)).
 *  Returns the kept indices. The anchors arrive sorted by md index; a handful of them
 *  disagree with html row order (a doc genuinely moved across the migration), and those
 *  would make "the gap between anchor i and anchor i+1" meaningless on one side. Keeping
 *  the longest order-consistent run drops exactly those. */
function increasingRun(rows) {
  const tails = [], tailIdx = [], prev = new Array(rows.length).fill(-1);
  for (let i = 0; i < rows.length; i++) {
    let lo = 0, hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (tails[mid] < rows[i]) lo = mid + 1; else hi = mid; }
    tails[lo] = rows[i];
    tailIdx[lo] = i;
    prev[i] = lo > 0 ? tailIdx[lo - 1] : -1;
  }
  const out = [];
  for (let i = tailIdx[tailIdx.length - 1] ?? -1; i >= 0; i = prev[i]) out.push(i);
  return out.reverse();
}

/** Group indices by key, preserving order. */
function bucket(indices, keyOf) {
  const m = new Map();
  for (const i of indices) {
    const k = keyOf(i);
    if (k == null) continue;
    let a = m.get(k);
    if (!a) m.set(k, (a = []));
    a.push(i);
  }
  return m;
}

/** Pair equal-sized buckets k-th ↔ k-th; returns the md indices left unpaired. */
function pairBuckets(mdIdx, rowIdx, mdKey, rowKey, out) {
  const mdB = bucket(mdIdx, mdKey), rowB = bucket(rowIdx, rowKey);
  const leftover = [];
  for (const [k, mds] of mdB) {
    const rows = rowB.get(k);
    // Same key, same count, same gap → the atlas's own order is the disambiguator.
    // Different counts mean something was inserted or removed here: genuinely
    // ambiguous, so leave it for the caller to report as untraced.
    if (!rows || rows.length !== mds.length) { leftover.push(...mds); continue; }
    for (let i = 0; i < mds.length; i++) out.push([mds[i], rows[i]]);
    rowB.delete(k);
  }
  return leftover;
}

/**
 * @param {{title?: string, content?: string}[]} mdNodes  #117 markdown docs, in document order
 * @param {{title?: string, content?: string}[]} htmlNodes  last-HTML rows, in row order
 * @param {object} opts
 * @param {Set<number>} opts.mdZero   md indices the shingle pass could not see (no shingles, unclaimed)
 * @param {Set<number>} opts.rowZero  html row indices the shingle pass skipped (no shingles, unclaimed)
 * @param {[number, number][]} opts.anchors  shingle-matched [mdIndex, rowIndex] pairs
 * @param {(s: string) => string} opts.norm  the seed's cross-format token normaliser
 * @returns {{pairs: [number, number][], stats: {gaps: number, exact: number, byTitle: number, ambiguous: number}}}
 */
export function positionalSeed(mdNodes, htmlNodes, { mdZero, rowZero, anchors, norm }) {
  const pairs = [];
  const stats = { gaps: 0, exact: 0, byTitle: 0, ambiguous: 0 };
  if (!mdZero.size || !rowZero.size) return { pairs, stats };

  const sorted = [...anchors].sort((a, b) => a[0] - b[0]);
  const spine = increasingRun(sorted.map(([, ri]) => ri)).map((i) => sorted[i]);
  // Boundaries bracket every gap, including the head (before the first anchor) and the
  // tail (after the last) — a doc at either end still sits in a well-defined interval.
  const bounds = [[-1, -1], ...spine, [mdNodes.length, htmlNodes.length]];

  const mdOrdered = [...mdZero].sort((a, b) => a - b);
  const rowOrdered = [...rowZero].sort((a, b) => a - b);
  let mdCursor = 0, rowCursor = 0;

  const titleOf = (n) => norm(n?.title || "");
  const bodyOf = (n) => norm(n?.content || "");

  for (let b = 0; b + 1 < bounds.length; b++) {
    const [mdLo, rowLo] = bounds[b], [mdHi, rowHi] = bounds[b + 1];
    const mdGap = [], rowGap = [];
    while (mdCursor < mdOrdered.length && mdOrdered[mdCursor] < mdHi) {
      if (mdOrdered[mdCursor] > mdLo) mdGap.push(mdOrdered[mdCursor]);
      mdCursor++;
    }
    while (rowCursor < rowOrdered.length && rowOrdered[rowCursor] < rowHi) {
      if (rowOrdered[rowCursor] > rowLo) rowGap.push(rowOrdered[rowCursor]);
      rowCursor++;
    }
    if (!mdGap.length || !rowGap.length) { stats.ambiguous += mdGap.length; continue; }
    stats.gaps++;

    // Pass 1: identical title AND body — the strongest form (the doc crossed the seam
    // unchanged). Pass 2: the leftovers by title alone — same document, edited at the
    // migration. A doc with no title has nothing to key on and is left untraced.
    const before = pairs.length;
    const key = (nodes) => (i) => (titleOf(nodes[i]) ? `${titleOf(nodes[i])}\u0000${bodyOf(nodes[i])}` : null);
    const leftover = pairBuckets(mdGap, rowGap, key(mdNodes), key(htmlNodes), pairs);
    stats.exact += pairs.length - before;

    const claimed = new Set(pairs.slice(before).map(([, ri]) => ri));
    const rowsLeft = rowGap.filter((ri) => !claimed.has(ri));
    const mid = pairs.length;
    const tKey = (nodes) => (i) => titleOf(nodes[i]) || null;
    const stillLeft = pairBuckets(leftover, rowsLeft, tKey(mdNodes), tKey(htmlNodes), pairs);
    stats.byTitle += pairs.length - mid;
    stats.ambiguous += stillLeft.length;
  }
  stats.ambiguous += mdOrdered.length - mdCursor; // md docs past the last boundary

  return { pairs, stats };
}
