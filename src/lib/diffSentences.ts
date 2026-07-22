// Sentence-level segmentation and change-density helpers for the render-time
// prose diff refinement (src/lib/diffProse.ts). Pure, no React.

import type { WordSegment } from "./history";

// Dual promotion thresholds, shared by sentence-pair and paragraph-level
// promotion: a contiguous rewrite reads fine up to a much higher fraction of
// a unit than a scattered one does, so the two shapes get different bars.
// See `shouldPromote` below for the exact rule.
/** Ratio bar for a SCATTERED change (>=2 changed runs, post island-absorption). */
export const RATIO_SCATTERED = 0.22;
/** Ratio bar for a CONTIGUOUS change (exactly 1 changed run). Higher than
 *  RATIO_SCATTERED — "a contiguous 30% swap is readable; 20% scattered
 *  across the structure is not." */
export const RATIO_CONTIG = 0.3;

/** Above this non-alphanumeric-character density, a line is treated as
 *  structured (table/code/key-value/etc.) rather than prose. */
export const SYMBOL_DENSITY_MAX = 0.25;

/** An "=" segment of at most this many non-whitespace characters, sitting
 *  between two changed segments, is a small accidental LCS match ("the",
 *  "of", "a", "to", "and", ...) rather than a meaningful shared unit — see
 *  `absorbIslands` in ./diffIslands. */
export const MAX_ISLAND = 4;

/** Below this whole-line change ratio the stored word diff is already
 *  minimal and readable — refinement (sentence segmentation, promotion)
 *  never runs. Guards near-noise edits (e.g. "1)" → "1." across a list)
 *  from being amplified by a pathological sentence split. */
export const MIN_REFINE_RATIO = 0.05;

// Boundary: whitespace preceded by sentence-ending punctuation, followed by a
// capital letter. Skipped when the text right before the boundary ends with a
// known abbreviation ("e.g.", "Dr.", ...), a single-letter initial ("J.",
// "a."), or a 1–2 digit enumerator ("1.", "12." — list numbering, not a
// sentence end; \b keeps years like "2024." out of the guard).
const ABBREV_RE = /(?:\b(?:e\.g|i\.e|etc|vs|cf|Dr|Mr|Mrs|Ms|No)|\b[A-Za-z]|\b\d{1,2})\.$/;
const BOUNDARY_RE = /(?<=[.!?])\s+(?=[A-Z])/g;

/** Split a line into sentences, LOSSLESSLY: `segmentSentences(line).join("")
 *  === line` always holds. Trailing whitespace attaches to the preceding
 *  sentence. Over-segmentation on a missed abbreviation is acceptable — the
 *  join property still holds either way. */
export function segmentSentences(line: string): string[] {
  const sentences: string[] = [];
  let start = 0;
  for (const match of line.matchAll(BOUNDARY_RE)) {
    const idx = match.index;
    if (ABBREV_RE.test(line.slice(0, idx))) continue;
    const end = idx + match[0].length;
    sentences.push(line.slice(start, end));
    start = end;
  }
  sentences.push(line.slice(start));
  return sentences;
}

/** Split a sentence into subclauses, LOSSLESSLY: `segmentSubclauses(s).join("")
 *  === s` always holds. Boundaries: after "," or ";" (the delimiter and any
 *  following whitespace attach to the PRECEDING unit, same style as
 *  segmentSentences); a parenthetical `( ... )` is its own standalone unit —
 *  the text before "(" ends the previous unit, the whole parenthetical
 *  (through the first ")", nesting ignored) is one unit, text after ")"
 *  starts a new one. Guard: a "," immediately followed by a digit ("1,000")
 *  is not a boundary. An unclosed "(" is not a boundary either — the rest of
 *  the string becomes one trailing unit, so this stays lossless either way. */
export function segmentSubclauses(sentence: string): string[] {
  const units: string[] = [];
  let start = 0;
  let i = 0;
  const n = sentence.length;
  while (i < n) {
    const ch = sentence[i];
    if (ch === "(") {
      if (i > start) {
        units.push(sentence.slice(start, i));
        start = i;
      }
      const close = sentence.indexOf(")", i);
      if (close === -1) break; // unclosed — bail, trailing push below covers it
      units.push(sentence.slice(start, close + 1));
      start = close + 1;
      i = start;
      continue;
    }
    if ((ch === "," || ch === ";") && !(ch === "," && /\d/.test(sentence[i + 1] ?? ""))) {
      let end = i + 1;
      while (end < n && /\s/.test(sentence[end])) end++;
      units.push(sentence.slice(start, end));
      start = end;
      i = end;
      continue;
    }
    i++;
  }
  if (start < n) units.push(sentence.slice(start));
  return units.length ? units : [sentence];
}

const KEY_VALUE_RE = /^(?:[-*]\s+)?[A-Za-z][\w ()/-]{0,40}:\s/;
const MID_SENTENCE_PUNCT_RE = /[.!?]\s/;

/** True when a line is structured content (table row, heading, code fence,
 *  indented code, symbol-dense, or a `key: value` line) rather than prose —
 *  such lines keep the existing word-level diff behavior untouched. */
export function isStructuredLine(line: string): boolean {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("|")) return true;
  if (trimmed.startsWith("#")) return true;
  if (trimmed.startsWith("```")) return true;
  if (/^(\t| {4})/.test(line)) return true;

  const nonSpace = line.replace(/\s/g, "");
  if (nonSpace.length > 0) {
    const symbols = nonSpace.replace(/[A-Za-z0-9]/g, "");
    if (symbols.length / nonSpace.length > SYMBOL_DENSITY_MAX) return true;
  }

  if (KEY_VALUE_RE.test(trimmed) && !MID_SENTENCE_PUNCT_RE.test(trimmed)) return true;

  return false;
}

/** Changed-character ratio and run count for word-diff segments. Whitespace
 *  never counts as content: every count strips `\s` from the full segment
 *  text first (not just whitespace-only segments).
 *  `ratio` = (non-ws removed + added) / (non-ws old side + new side chars),
 *  guarded against div-by-zero (a spacing-only diff has ratio 0).
 *  `removed`/`added` = raw non-ws char counts per side, for a both-sides
 *  promotion guard (a purely-inserted/deleted change never promotes).
 *  `runs` = number of maximal changed regions. A ZERO-non-ws segment (a
 *  whitespace-only "-", "+", or "=") is transparent to run counting: it
 *  neither starts/extends a run nor separates two runs — a whitespace-only
 *  "=" between two changed regions reads as one contiguous block, while a
 *  real unchanged WORD between them genuinely separates them into two. */
export function changeStats(
  segs: WordSegment[],
): { ratio: number; runs: number; removed: number; added: number } {
  let removed = 0;
  let added = 0;
  let oldLen = 0;
  let newLen = 0;
  let runs = 0;
  let inRun = false;
  for (const [op, text] of segs) {
    const len = text.replace(/\s/g, "").length;
    if (len === 0) continue; // whitespace-only: transparent to run counting
    if (op === "-") {
      removed += len;
      oldLen += len;
      inRun = true;
    } else if (op === "+") {
      added += len;
      newLen += len;
      inRun = true;
    } else {
      oldLen += len;
      newLen += len;
      if (inRun) {
        runs++;
        inRun = false;
      }
    }
  }
  if (inRun) runs++;
  const total = oldLen + newLen;
  return { ratio: total > 0 ? (removed + added) / total : 0, runs, removed, added };
}

/** The single promotion decision, applied identically at sentence-pair and
 *  paragraph level: collapse to a whole-unit before/after replacement, or
 *  keep the fine-grained word-level diff.
 *  - Both-sides guard: a purely-inserted or purely-deleted change (e.g. a
 *    clause appended to an otherwise identical sentence) never promotes, no
 *    matter the ratio — striking old text to show a pure append/delete would
 *    be worse than the word-level diff it replaces.
 *  - Contiguous (runs === 1): promotes above RATIO_CONTIG — a single
 *    shared-prefix-then-fully-replaced run stays readable to a higher bar.
 *  - Scattered (runs >= 2): promotes above RATIO_SCATTERED — many small
 *    interleaved changes ("confetti") read poorly much sooner.
 *  - runs === 0 means no real (non-whitespace) change at all — never promotes. */
export function shouldPromote(stats: { ratio: number; runs: number; removed: number; added: number }): boolean {
  if (stats.removed === 0 || stats.added === 0) return false;
  if (stats.runs === 1) return stats.ratio > RATIO_CONTIG;
  if (stats.runs >= 2) return stats.ratio > RATIO_SCATTERED;
  return false;
}
