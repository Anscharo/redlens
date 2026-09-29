// How much of one text survives in another: by lines, and by words in order.
// The measures every rule of the identity gate is built from. Pure.
//
// The word matching itself (typo-tolerant, order-sensitive) lives in
// scripts/lib/ordered-containment.mjs, shared with the HTML-era history
// curation. There is one implementation; a change there changes the gate.

import { lcsOps } from "../../lib/diffCore";
import * as contain from "../../../scripts/lib/ordered-containment.mjs";

// The body test compares words in full up to this many cells (2,000 words a
// side): the largest real edit, 1,223 x 1,290 words, takes 48ms, and the test
// runs once per retitled document, not once per pair.
export const BODY_TEST_MAX_CELLS = 4_000_000;

export const norm = (t: string | undefined): string => contain.norm(t);
export const words = (t: string | undefined): string[] => contain.words(t);

export function lines(t: string | undefined): string[] {
  return (t ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Fraction of `oldText`'s words that appear, IN ORDER (LCS), inside `candText`
 *  — words matched fuzzily so subword typos don't break the alignment, and
 *  `candText` may carry extra words (the LCS skips them). 1.0 = the whole old
 *  body is present (possibly expanded); ~0 = unrelated. 0 below four words.
 *
 *  Cost-capped: when both bodies exceed ~632 words it falls back to an exact
 *  substring test. Deliberately binary — a relocated-but-reformatted giant doc
 *  returns 0 (declines the relocation link) rather than risk a slow or wrong
 *  fuzzy match. Right for a relocation link, wrong for the body test: use
 *  bodyWordsKept there. */
export function orderedWordContainment(oldText: string | undefined, candText: string | undefined): number {
  return contain.orderedWordContainment(oldText, candText);
}

/** How many of `a`'s words appear in `b`, in order. No cost cap. O(a·b). */
export const wordsInOrder = (a: string[], b: string[]): number => contain.wordsInOrder(a, b);

/** Fraction of the old body's words still present, in order, in the new body —
 *  orderedWordContainment without its binary fallback, which answers 0 for ANY
 *  change to a body over ~632 words and would read that as "replaced". Returns
 *  null when the bodies are too large to compare in full. */
export function bodyWordsKept(oldBody: string | undefined, newBody: string | undefined): number | null {
  const a = words(oldBody);
  const b = words(newBody);
  if (a.length === 0) return null;
  if (a.length * b.length > BODY_TEST_MAX_CELLS) return null;
  return wordsInOrder(a, b) / a.length;
}

/** Fraction of the FIRST text's lines preserved (in order, via LCS) in the
 *  SECOND — how much of `a` survives into `b`. Directional on purpose: the swap
 *  gate calls it lineOverlap(oldBody, newBody) to ask "how much of the OLD body
 *  is still here?". Normalizing by `la.length` (the old side), not the longer
 *  side, means a short old body fully retained inside a much larger new body
 *  scores ~1 (preserved) instead of ~0 — so a stub that gets expanded under a
 *  new title is NOT misread as a wholesale replacement. (0 = none of `a`
 *  survives … 1 = all of it does.)
 *
 *  BINARY on a one-line body, and 83% of the atlas is one line: a typo fix and
 *  a replacement both score 0 there. It never decides alone. */
export function lineOverlap(a: string | undefined, b: string | undefined): number {
  const la = lines(a);
  const lb = lines(b);
  if (la.length === 0 && lb.length === 0) return 1;
  if (la.length === 0 || lb.length === 0) return 0;
  const shared = lcsOps(la, lb).filter(([op]) => op === "=").length;
  return shared / la.length;
}
