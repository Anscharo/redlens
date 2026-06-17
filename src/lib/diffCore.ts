// Shared diff core — the single implementation of the LCS / word-diff /
// line-pairing machinery used by BOTH history pipelines:
//   scripts/required/build-history.mjs  (live atlas history → Postgres; Bun)
//   src/server/preview/patch-diff.ts    (preview diffs: GitHub patches + identity diffs)
//   src/components/preview/BuildErrorDetail.tsx (char-level build-error highlight)
// Pure functions, no imports beyond types — safe in scripts, server, and client.
// Output shapes match lib/history's DiffLine/WordSegment exactly; build-history
// row output must stay byte-identical, so change semantics here with care.

import type { DiffLine, WordSegment } from "./history";

/** Generic LCS backtrack over token arrays → [op, token][] (op: "="|"+"|"-"). */
export function lcsOps(a: string[], b: string[]): [string, string][] {
  const m = a.length;
  const n = b.length;
  const dp: Int32Array[] = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const ops: [string, string][] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.push(["=", a[i - 1]]);
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push(["+", b[j - 1]]);
      j--;
    } else {
      ops.push(["-", a[i - 1]]);
      i--;
    }
  }
  ops.reverse();
  return ops;
}

/** Merge consecutive same-op tokens into single segments. */
function mergeOps(raw: [string, string][]): WordSegment[] {
  const merged: WordSegment[] = [];
  for (const [op, tok] of raw) {
    const last = merged[merged.length - 1];
    if (last && last[0] === op) last[1] += tok;
    else merged.push([op as WordSegment[0], tok]);
  }
  return merged;
}

/** Word-level diff of one line pair. Tokenises on word/whitespace/punctuation. */
export function wordDiff(prevLine: string, currLine: string): WordSegment[] {
  const a = prevLine.match(/\w+|\s+|[^\w\s]/g) ?? [];
  const b = currLine.match(/\w+|\s+|[^\w\s]/g) ?? [];
  return mergeOps(lcsOps(a, b));
}

/** Character-level diff (for short identifiers — build-error highlighting). */
export function charDiff(a: string, b: string): WordSegment[] {
  return mergeOps(lcsOps([...a], [...b]));
}

/** Pair adjacent −/+ line runs 1:1 into ["~", wordDiff] intraline entries when
 *  the lines share content; wholly-different pairs stay separate −/+. Context
 *  ("=") lines pass through and break runs. */
export function pairAdjacentLines(rawOps: [string, string][]): DiffLine[] {
  const ops: DiffLine[] = [];
  let k = 0;
  while (k < rawOps.length) {
    if (rawOps[k][0] === "=") {
      ops.push(["=", rawOps[k][1]]);
      k++;
      continue;
    }
    const removals: [string, string][] = [];
    while (k < rawOps.length && rawOps[k][0] === "-") removals.push(rawOps[k++]);
    const additions: [string, string][] = [];
    while (k < rawOps.length && rawOps[k][0] === "+") additions.push(rawOps[k++]);

    if (removals.length && additions.length) {
      const pairs = Math.min(removals.length, additions.length);
      for (let p = 0; p < pairs; p++) {
        const wd = wordDiff(removals[p][1], additions[p][1]);
        if (wd.some(([op]) => op === "=")) ops.push(["~", wd]);
        else {
          ops.push(["-", removals[p][1]]);
          ops.push(["+", additions[p][1]]);
        }
      }
      for (let p = pairs; p < removals.length; p++) ops.push(["-", removals[p][1]]);
      for (let p = pairs; p < additions.length; p++) ops.push(["+", additions[p][1]]);
    } else {
      for (const o of removals) ops.push(["-", o[1]]);
      for (const o of additions) ops.push(["+", o[1]]);
    }
  }
  return ops;
}

/** Trim to changed lines ± `context` unchanged neighbours, "…" between hunks.
 *  No leading/trailing gap markers (live-history convention). */
export function trimContext(ops: DiffLine[], context = 2): DiffLine[] {
  const keep = new Set<number>();
  for (let i = 0; i < ops.length; i++) {
    if (ops[i][0] !== "=") {
      for (let c = Math.max(0, i - context); c <= Math.min(ops.length - 1, i + context); c++) keep.add(c);
    }
  }
  if (keep.size === 0) return [];
  const out: DiffLine[] = [];
  let last = -1;
  for (let i = 0; i < ops.length; i++) {
    if (!keep.has(i)) continue;
    if (last >= 0 && i > last + 1) out.push(["…"]);
    out.push(ops[i]);
    last = i;
  }
  return out;
}

/** Cap a diff at `max` lines with a trailing "…" (live-history convention). */
export function capDiff(lines: DiffLine[], max = 20): DiffLine[] {
  return lines.length > max ? [...lines.slice(0, max), ["…"] as DiffLine] : lines;
}

/** Full line diff of two texts — exact live-history semantics: `""` is one
 *  empty line (use contentDiff-style callers for "no content"), pairing +
 *  ±2 context, NO cap (callers cap). */
export function lineDiff(prevText: string, currText: string): DiffLine[] {
  const a = (prevText || "").split("\n");
  const b = (currText || "").split("\n");
  return trimContext(pairAdjacentLines(lcsOps(a, b)));
}
