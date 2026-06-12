// Parse GitHub's unified-diff `patch` field (from the PR-files / compare APIs)
// into the same DiffLine[] shape the live history path emits, so preview history
// renders through the existing <DiffView> with identical word-level intraline
// highlighting. The LCS + word-diff + −/+ run-pairing logic is ported verbatim
// from scripts/required/build-history.mjs (lcsOps / wordDiff / lineDiff's pairing
// pass) — the only difference is the *input*: we already have the hunks from
// GitHub, so we skip the line-level LCS and feed the patch's own ±/context lines
// straight into the pairing pass.

import type { DiffLine, WordSegment } from "../../lib/history";

// Generic LCS backtrack — returns [op, token][] (op: "="|"+"|"-").
function lcsOps(a: string[], b: string[]): [string, string][] {
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

// Word-level diff for a single changed line pair. Tokenises on
// word/whitespace/punctuation boundaries; merges consecutive same-op tokens.
function wordDiff(prevLine: string, currLine: string): WordSegment[] {
  const a = prevLine.match(/\w+|\s+|[^\w\s]/g) ?? [];
  const b = currLine.match(/\w+|\s+|[^\w\s]/g) ?? [];
  const raw = lcsOps(a, b);
  const merged: WordSegment[] = [];
  for (const [op, tok] of raw) {
    const last = merged[merged.length - 1];
    if (last && last[0] === op) last[1] += tok;
    else merged.push([op as WordSegment[0], tok]);
  }
  return merged;
}

// Pair adjacent −/+ runs 1:1 → ["~", wordDiff] when the lines share content,
// otherwise keep them as separate −/+ lines. Context ("=") lines pass through and
// naturally break runs. Ported from build-history.mjs lineDiff's pairing pass,
// minus the line-level LCS (GitHub already gave us the ops) and the context trim
// (the patch is already context-limited by GitHub).
function pairRuns(rawOps: [string, string][]): DiffLine[] {
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

// Identity diff: two versions of the SAME doc's content → DiffLine[]. Used for
// "changed" preview docs instead of GitHub's per-path patch, which crosses doc
// identities when documents are renumbered (the file at a path can change
// occupants). Line-level LCS + the same pairing pass, trimmed to ±2 context
// with ["…"] gaps, capped like the live history diffs. NOTE: compares against
// CURRENT main, not the merge base — if main edited the same doc after the
// fork branched, those edits appear too; acceptable for "vs live atlas".
export function contentDiff(prev: string, curr: string, maxLines = 20): DiffLine[] {
  if (prev === curr) return [];
  // "" means NO lines, not one empty line — split would yield [""] and emit a
  // spurious ["-",""] when diffing against empty (brand-new doc content).
  const a = prev === "" ? [] : prev.split("\n");
  const b = curr === "" ? [] : curr.split("\n");
  const ops = pairRuns(lcsOps(a, b));
  const CONTEXT = 2;
  const keep = new Set<number>();
  for (let i = 0; i < ops.length; i++) {
    if (ops[i][0] !== "=") {
      for (let c = Math.max(0, i - CONTEXT); c <= Math.min(ops.length - 1, i + CONTEXT); c++) keep.add(c);
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
  return out.length > maxLines ? [...out.slice(0, maxLines), ["…"] as DiffLine] : out;
}

// A unified-diff patch → DiffLine[]. Hunks (`@@ ... @@`) become ["…"] gaps;
// each hunk body's ±/context lines flow through pairRuns. Capped at `maxLines`
// (matching the live history path's 20-line cap) with a trailing ["…"].
export function patchToDiffLines(patch: string | undefined | null, maxLines = 20): DiffLine[] {
  if (!patch) return [];
  const out: DiffLine[] = [];
  let started = false;
  let cur: [string, string][] = [];
  const flush = () => {
    if (!cur.length) return;
    if (started) out.push(["…"]);
    out.push(...pairRuns(cur));
    started = true;
    cur = [];
  };
  for (const line of patch.split("\n")) {
    if (line === "") continue; // trailing split artifact; real blank context is " "
    if (line.startsWith("@@")) {
      flush();
      continue;
    }
    if (line.startsWith("\\")) continue; // "\ No newline at end of file"
    const tag = line[0];
    const text = line.slice(1);
    if (tag === "+") cur.push(["+", text]);
    else if (tag === "-") cur.push(["-", text]);
    else cur.push(["=", text]); // leading space = context
  }
  flush();
  return out.length > maxLines ? [...out.slice(0, maxLines), ["…"] as DiffLine] : out;
}
