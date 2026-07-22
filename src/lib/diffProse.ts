// Render-time refinement of modified-paragraph ("~") diff entries. Promotion
// runs word -> sentence -> paragraph: island absorption (./diffIslands)
// first repairs cosmetic word-level "=" gaps so a rewrite reads as one
// contiguous block, then each sentence pair — and, failing that, the
// assembled paragraph — gets the same shouldPromote decision
// (./diffSentences): whitespace-neutral ratio, dual bar (a contiguous run
// promotes above RATIO_CONTIG; a scattered, >=2-run change promotes above
// the lower RATIO_SCATTERED), and a change to only one side (pure
// insert/delete) never promotes. The ratio is always PRE-absorption, so
// absorbed island chars never inflate it — absorption only reshapes what's
// displayed, never what's counted. Applied ONLY at render time
// (src/components/history/DiffView.tsx) — DISPLAY-ONLY: never fed back into
// classifyDiff or written to storage; the stored DB diff is untouched.

import type { DiffLine, WordSegment } from "./history";
import { lcsOps, wordDiff, mergeOps } from "./diffCore";
import { isStructuredLine, segmentSentences, changeStats, shouldPromote } from "./diffSentences";
import { absorbIslands } from "./diffIslands";

type SentenceOp = { op: "=" | "-" | "+"; text: string };

/** LCS over sentence arrays, comparing on `trimEnd()`-normalized text but
 *  recovering the ORIGINAL sentence slices (so joining "="+"-" segments still
 *  reconstructs oldLine, and "="+"+" reconstructs newLine, up to inter-sentence
 *  whitespace). "=" ops emit the NEW side's original slice. */
function sentenceOps(oldSentences: string[], newSentences: string[]): SentenceOp[] {
  const oldKeys = oldSentences.map((s) => s.trimEnd());
  const newKeys = newSentences.map((s) => s.trimEnd());
  const raw = lcsOps(oldKeys, newKeys);
  const out: SentenceOp[] = [];
  let i = 0;
  let j = 0;
  for (const [op] of raw) {
    if (op === "=") {
      out.push({ op: "=", text: newSentences[j] });
      i++;
      j++;
    } else if (op === "-") {
      out.push({ op: "-", text: oldSentences[i] });
      i++;
    } else {
      out.push({ op: "+", text: newSentences[j] });
      j++;
    }
  }
  return out;
}

/** Walk sentence ops region-by-region (mirrors pairAdjacentLines in
 *  diffCore): each maximal run of "-" ops followed by "+" ops between "="
 *  ops is one region. Sentences pair 1:1 by position within a region; if ANY
 *  pair's word diff earns promotion (shouldPromote, see ./diffSentences) the
 *  WHOLE region (including unpaired leftovers) collapses to one "-" block +
 *  one "+" block. Otherwise each pair's word-level diff — island-absorbed
 *  for display — is emitted in order, followed by unpaired leftover
 *  sentences as plain "-"/"+" segments. */
function buildSegments(ops: SentenceOp[]): WordSegment[] {
  const result: WordSegment[] = [];
  let k = 0;
  while (k < ops.length) {
    if (ops[k].op === "=") {
      result.push(["=", ops[k].text]);
      k++;
      continue;
    }
    const removals: string[] = [];
    while (k < ops.length && ops[k].op === "-") removals.push(ops[k++].text);
    const additions: string[] = [];
    while (k < ops.length && ops[k].op === "+") additions.push(ops[k++].text);

    const pairs = Math.min(removals.length, additions.length);
    const pairSegs: WordSegment[][] = [];
    let anyPromote = false;
    for (let p = 0; p < pairs; p++) {
      const wd = wordDiff(removals[p], additions[p]);
      // PRE-absorption stats for the promotion ratio (island chars must not
      // inflate it); POST-absorption runs for the visual run-shape check.
      const genuine = changeStats(wd);
      const absorbed = absorbIslands(wd);
      const promoteStats = { ...genuine, runs: changeStats(absorbed).runs };
      if (shouldPromote(promoteStats)) anyPromote = true;
      pairSegs.push(absorbed);
    }

    if (anyPromote) {
      result.push(["-", removals.join("")]);
      result.push(["+", additions.join("")]);
    } else {
      for (const wd of pairSegs) result.push(...wd);
      for (let p = pairs; p < removals.length; p++) result.push(["-", removals[p]]);
      for (let p = pairs; p < additions.length; p++) result.push(["+", additions[p]]);
    }
  }
  return result;
}

function isWellFormedTilde(line: unknown): line is ["~", WordSegment[]] {
  if (!Array.isArray(line) || line[0] !== "~") return false;
  const segs: unknown = line[1];
  if (!Array.isArray(segs)) return false;
  return segs.every(
    (seg) =>
      Array.isArray(seg) &&
      seg.length === 2 &&
      (seg[0] === "=" || seg[0] === "+" || seg[0] === "-") &&
      typeof seg[1] === "string",
  );
}

function refineTilde(segments: WordSegment[]): DiffLine[] {
  const original: DiffLine[] = [["~", segments]];
  const oldLine = segments
    .filter(([op]) => op === "=" || op === "-")
    .map(([, t]) => t)
    .join("");
  const newLine = segments
    .filter(([op]) => op === "=" || op === "+")
    .map(([, t]) => t)
    .join("");

  if (isStructuredLine(oldLine) || isStructuredLine(newLine)) return original;

  const ops = sentenceOps(segmentSentences(oldLine), segmentSentences(newLine));
  const raw = buildSegments(ops);
  const merged = mergeOps(raw);

  // Lint fallback: nothing changed after refinement (whitespace-only diff at
  // the sentence boundary) — keep the original word-level entry visible.
  if (!merged.some(([op]) => op === "+" || op === "-")) return original;

  if (!merged.some(([op]) => op === "=")) return [["-", oldLine], ["+", newLine]];

  // No island absorption here: a promoted sentence already counts as fully
  // changed, and a leftover "=" island is a few chars — negligible at
  // paragraph scale — so the raw (pre-absorption) merged stats decide.
  //
  // Require SCATTERED changes (runs >= 2) before collapsing the paragraph: a
  // single contiguous run is already one promoted sentence (or an
  // adjacent-coalesced group) shown as [=ctx][-old][+new][=ctx] — the
  // optimal display. RATIO_CONTIG is calibrated for a word/sentence-level
  // rewrite staying visually intact; at paragraph grain a single swap can
  // trivially clear 30% just by being one sentence among short ones, and
  // collapsing would just re-print unchanged context twice for no benefit.
  // Gating on runs >= 2 forces shouldPromote down its RATIO_SCATTERED branch.
  const stats = changeStats(merged);
  if (stats.runs >= 2 && shouldPromote(stats)) return [["-", oldLine], ["+", newLine]];

  return [["~", merged]];
}

/** Refine every modified-paragraph ("~") entry in a diff for display: fine-
 *  grained word diffs stay when the change is localized, but a substantially
 *  rewritten sentence or paragraph is promoted to a whole-unit before/after
 *  block. All other entries (and malformed ones) pass through untouched. */
export function refineProseDiff(lines: DiffLine[]): DiffLine[] {
  if (!Array.isArray(lines)) return [];
  const out: DiffLine[] = [];
  for (const line of lines) {
    if (isWellFormedTilde(line)) out.push(...refineTilde(line[1]));
    else out.push(line);
  }
  return out;
}
