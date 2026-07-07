// Ordered, typo-tolerant word containment — ported from the preview UUID-swap detector
// (src/server/preview/identity.ts, PR #108) for use as an INDEPENDENT third corroborator
// in HTML-era auto-curation (plan §10.4).
//
// WHY this and not more shingle-Jaccard. The reverse matcher (greedy shingle) and the
// forward tracer (mutual-best shingle) are BOTH bag-of-8-grams overlap, so they share a
// blind spot: near-identical boilerplate siblings. The UUID-swap work measured a ~22%
// false-positive rate from loose word-overlap on exactly that ("Completed Instances
// Directory" …) and fixed it with ORDER-SENSITIVE, ASYMMETRIC, typo-tolerant containment.
// That makes it methodologically independent of the two shingle passes — strongest where
// they are weakest — so agreement between it and the reverse matcher is real corroboration.

const words = (t) => (t ?? "").toLowerCase().match(/[a-z0-9]+/g) ?? [];
const norm = (t) => (t ?? "").toLowerCase().replace(/\s+/g, " ").trim();

export const MIN_WORDS = 4; // shorter bodies aren't distinctive enough to corroborate
export const wordCount = (t) => words(t).length;

// Bounded Levenshtein: are `a` and `b` within `tol` single-char edits? Early-exits once
// a whole DP row exceeds the budget.
function withinEdits(a, b, tol) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > tol) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < best) best = cur[j];
    }
    if (best > tol) return false;
    prev = cur;
  }
  return prev[b.length] <= tol;
}

// Two words are equal if identical or a small typo apart — longer words tolerate more,
// short words must be exact (too easy to collide otherwise).
export function wordEq(a, b) {
  if (a === b) return true;
  const tol = a.length <= 4 ? 0 : a.length <= 8 ? 1 : 2;
  return tol > 0 && withinEdits(a, b, tol);
}

// Fraction of `a`'s words present, IN ORDER (LCS over words, fuzzy-equal), inside `b`
// (which may carry extra words the LCS skips). 1 = all of `a` survives into `b`; ~0 =
// unrelated. Cost-capped: for two large bodies, fall back to an exact normalized
// substring test rather than a slow O(a·b) DP.
export function orderedWordContainment(a, b) {
  const A = words(a), B = words(b);
  if (A.length < MIN_WORDS) return 0;
  if (A.length * B.length > 400_000) return norm(b).includes(norm(a)) ? 1 : 0;
  const dp = new Array(B.length + 1).fill(0);
  for (let i = 1; i <= A.length; i++) {
    let diag = 0;
    for (let j = 1; j <= B.length; j++) {
      const up = dp[j];
      dp[j] = wordEq(A[i - 1], B[j - 1]) ? diag + 1 : Math.max(dp[j], dp[j - 1]);
      diag = up;
    }
  }
  return dp[B.length] / A.length;
}

// Symmetric "are these the same document?" score: the better-preserved direction. High
// when one body is an edit / expansion / contraction of the other (older content survives
// into the newer, or vice versa); low for unrelated docs. Threading edits the same doc,
// so the predecessor should score highest here.
export function sameDocScore(x, y) {
  return Math.max(orderedWordContainment(x, y), orderedWordContainment(y, x));
}

// Lineage (split/merge) detection — the relocationTarget idea from the UUID-swap detector,
// generalised. Find the UNIQUE doc in `pool` that CONTAINS `needle` (≥ minRatio of needle's
// words, in order) and is meaningfully LARGER than it (a proper container, not a 1:1 rename).
// Returns that container, or null when none qualify OR more than one does (ambiguous → flag,
// never guess; boilerplate that lands in many docs is rejected by the uniqueness check).
//   • split:  needle = a doc BORN at commit i; pool = commit i-1's docs → its parent (extracted_from)
//   • merge:  needle = a doc that DIED at commit i; pool = commit i's docs → its successor (merged_into)
export const RELOCATION_MIN_WORDS = 6;
export const RELOCATION_MIN_RATIO = 0.9;
export const RELOCATION_MIN_SIZE_MULT = 1.3;
export function findContainer(needle, pool, opts = {}) {
  const { minWords = RELOCATION_MIN_WORDS, minRatio = RELOCATION_MIN_RATIO, minSizeMult = RELOCATION_MIN_SIZE_MULT } = opts;
  const nLen = wordCount(needle);
  if (nLen < minWords) return null;
  let hit = null;
  for (const c of pool) {
    if (wordCount(c.content) < nLen * minSizeMult) continue; // near-equal → a rename/move, not an extraction
    if (orderedWordContainment(needle, c.content) >= minRatio) {
      if (hit) return null; // appears in >1 container → ambiguous
      hit = c;
    }
  }
  return hit;
}

// Rank candidates for `subject` by sameDocScore; returns { best, bestScore, margin } where
// margin is the gap to the runner-up. A high score with a CLEAR margin is what makes a
// corroboration safe — two near-identical siblings tie (margin≈0) and are declined, which
// is exactly the boilerplate trap the UUID-swap work was built to dodge.
export function bestByContainment(subjectContent, candidates) {
  let best = null, bestScore = 0, second = 0;
  for (const c of candidates) {
    const s = sameDocScore(subjectContent, c.content);
    if (s > bestScore) { second = bestScore; bestScore = s; best = c; }
    else if (s > second) second = s;
  }
  return { best, bestScore, margin: bestScore - second };
}
