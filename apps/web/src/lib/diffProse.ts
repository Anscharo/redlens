// Render-time refinement of modified-paragraph ("~") diff entries. Promotion
// runs word -> subclause -> sentence -> paragraph: island absorption
// (./diffIslands) first repairs cosmetic word-level "=" gaps so a rewrite
// reads as one contiguous block; a promoted sentence pair then tries
// subclause-level alignment (./diffSubclause) BEFORE collapsing to a whole
// swap — exact shared clauses (comma/semicolon/parenthetical units) stay
// plain text, only the changed ones swap; a whole-sentence swap is the
// fallback only when no subclause is shared. Every level (word, subclause,
// sentence, paragraph) uses the same shouldPromote decision
// (./diffSentences): whitespace-neutral ratio, dual bar (a contiguous run
// promotes above RATIO_CONTIG; a scattered, >=2-run change promotes above
// the lower RATIO_SCATTERED), and a change to only one side (pure
// insert/delete) never promotes. The ratio is always PRE-absorption, so
// absorbed island chars never inflate it — absorption only reshapes what's
// displayed, never what's counted. Applied ONLY at render time
// (src/components/history/DiffView.tsx) — DISPLAY-ONLY: never fed back into
// classifyDiff or written to storage; the stored DB diff is untouched.

import type { DiffLine, WordSegment } from "@/lib/history";
import { mergeOps } from "@/lib/diffCore";
import { isStructuredLine, segmentSentences, changeStats, shouldPromote, MIN_REFINE_RATIO } from "./diffSentences";
import { fencedFlags } from "./diffFences";
import { refineSentencePair } from "./diffSubclause";
import { assembleRegions, unitOps, type UnitOp } from "./diffRegions";

type SentenceOp = UnitOp;

/** LCS over sentence arrays, comparing on `trimEnd()`-normalized text but
 *  recovering the ORIGINAL sentence slices (see unitOps in ./diffRegions), so
 *  joining "="+"-" segments still reconstructs oldLine, and "="+"+"
 *  reconstructs newLine, up to inter-sentence whitespace. */
function sentenceOps(oldSentences: string[], newSentences: string[]): SentenceOp[] {
  return unitOps(oldSentences, newSentences, (s) => s.trimEnd());
}

/** Count maximal runs of non-"=" ops in a sentence-op sequence — i.e. how
 *  many SEPARATE LOCATIONS in the paragraph changed at sentence granularity.
 *  Deliberately structural, not content-based: unlike changeStats' runs
 *  (word/subclause-level), this doesn't grow just because one promoted
 *  sentence's own internal subclause refinement produced multiple changed
 *  regions — see the paragraph-level check in refineTilde for why that
 *  distinction matters. */
function countSentenceRegions(ops: SentenceOp[]): number {
  let runs = 0;
  let inRun = false;
  for (const o of ops) {
    if (o.op === "=") {
      if (inRun) {
        runs++;
        inRun = false;
      }
    } else inRun = true;
  }
  if (inRun) runs++;
  return runs;
}

/** Assemble sentence ops region-by-region (see assembleRegions): sentences
 *  pair 1:1 by position within a region, each refined via refineSentencePair
 *  (word diff, then subclause alignment if that promotes — see
 *  ./diffSubclause). */
function buildSegments(ops: SentenceOp[]): WordSegment[] {
  return assembleRegions(ops, refineSentencePair);
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

  // Near-noise floor: when the stored word diff barely changes the line, it
  // is already the minimal readable display — never let a pathological
  // sentence split amplify a tiny edit into a whole-unit swap.
  if (changeStats(segments).ratio < MIN_REFINE_RATIO) return original;

  const ops = sentenceOps(segmentSentences(oldLine), segmentSentences(newLine));
  const raw = buildSegments(ops);
  const merged = mergeOps(raw);

  // Lint fallback: nothing changed after refinement (whitespace-only diff at
  // the sentence boundary) — keep the original word-level entry visible.
  if (!merged.some(([op]) => op === "+" || op === "-")) return original;

  if (!merged.some(([op]) => op === "=")) return [["-", oldLine], ["+", newLine]];

  // No island absorption: a promoted sentence already counts as fully
  // changed, and a leftover island is negligible at paragraph scale — the
  // raw merged stats decide the ratio. But the SHAPE check must be
  // STRUCTURAL (countSentenceRegions), not changeStats' runs: a single
  // promoted sentence can now internally decompose into several
  // subclause-level runs (a swapped clause + a word-edited clause around a
  // shared "=" clause is already 2) without the PARAGRAPH being scattered —
  // it's still one sentence, optimally shown as [=ctx][subclause mix][=ctx].
  // Require >= 2 separate changed SENTENCES before collapsing the whole
  // paragraph: RATIO_CONTIG's "readable to a higher bar" doesn't transfer to
  // paragraph grain (one swap can trivially clear 30% among short context).
  const stats = changeStats(merged);
  if (countSentenceRegions(ops) >= 2 && shouldPromote(stats)) return [["-", oldLine], ["+", newLine]];

  return [["~", merged]];
}

/** Refine every modified-paragraph ("~") entry in a diff for display: fine-
 *  grained word diffs stay when the change is localized, but a substantially
 *  rewritten sentence or paragraph is promoted to a whole-unit before/after
 *  block. Lines inside a ``` block are exempt — sentence segmentation is a
 *  prose operation, and `isStructuredLine` alone can't see a fence the line
 *  isn't itself the delimiter of (see ./diffFences). All other entries (and
 *  malformed ones) pass through untouched. */
export function refineProseDiff(lines: DiffLine[]): DiffLine[] {
  if (!Array.isArray(lines)) return [];
  const fenced = fencedFlags(lines);
  const out: DiffLine[] = [];
  for (const [i, line] of lines.entries()) {
    if (!fenced[i] && isWellFormedTilde(line)) out.push(...refineTilde(line[1]));
    else out.push(line);
  }
  return out;
}
