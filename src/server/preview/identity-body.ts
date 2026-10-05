// The body test: was this document's body REPLACED, or edited? Pure.
//
// Every bar below was measured, and a wrong ⚠ on an innocent document costs
// more than a missed swap, which leaves an ordinary Δ. The tables, the corpora
// and the rejected alternatives are in
// docs/research/identity-swap-detection.md ("The bars in the code" lists which
// thread set each one). Re-measure before moving a bar.

import { bodyWordsKept, lineOverlap, lines, norm, words } from "./identity-text.ts";
import { sameTitle } from "./identity-titles.ts";
import type { SwapNode } from "./identity-types.ts";

// Replaced, by LINES: at most this share of the old body's lines survive.
export const REPLACE_MAX_OVERLAP = 0.15;
// Replaced, by WORDS: at most this share of the old body's words survive, in
// order. Higher than the line bar because unrelated prose still shares its
// stopwords.
export const REPLACE_MAX_WORD_OVERLAP = 0.5;
// Replaced, by MEANING: the cosine of the old and new search vectors (title +
// link-stripped body — see embeddings.ts) is at most this. Each embedding
// model's cosines sit in their own range, so the bar is per model, each set at
// the same operating point on the 70 real retitles, the sibling and unrelated
// swaps and the five real repurposed steps (docs/research/identity-swap-detection.md):
//   qwen3-embedding-8b 0.85: flags 6 of 70 retitles, misses 18.3% of siblings.
//   gemini-embedding-2 0.90: flags 6 of 70, misses 19.2%, catches all five
//     steps (max 0.836) and the procedure cut to a stub (0.897); the first plain
//     rename scores 0.929. Carried over, 0.85 would miss 37.2% of siblings.
// A model with no measured bar is judged by lines and words alone.
export const REPLACE_MAX_COSINE = 0.85;
const REPLACE_MAX_COSINE_BY_MODEL: Record<string, number> = {
  "qwen/qwen3-embedding-8b": REPLACE_MAX_COSINE,
  "google/gemini-embedding-2": 0.9,
};
export const replaceMaxCosineFor = (model: string): number | undefined => REPLACE_MAX_COSINE_BY_MODEL[model];
// Bodies of more than this many lines are judged by meaning when a vector is
// known. At or under it no cosine bar beat the word measure: a one-line
// sibling is too close in meaning.
export const SHORT_BODY_MAX_LINES = 3;
// A body with fewer words than this carries too little signal to call either
// way — every measure is dominated by stopwords — so it is never flagged.
export const JUDGEABLE_MIN_WORDS = 6;

/** Replaced by lines AND words: few of its lines survive and few of its words
 *  do. Each covers the other's blind spot — the line measure cannot tell a typo
 *  from a replacement in a one-line body, or a re-indented list from a
 *  rewritten one, and the word measure sees both. Asking both can only remove
 *  flags. A body too large to compare word by word is left to the lines. */
export function bodyWhollyReplaced(oldBody: string | undefined, newBody: string | undefined): boolean {
  if (words(oldBody).length < JUDGEABLE_MIN_WORDS) return false;
  if (lineOverlap(oldBody, newBody) > REPLACE_MAX_OVERLAP) return false;
  const kept = bodyWordsKept(oldBody, newBody);
  return kept === null || kept <= REPLACE_MAX_WORD_OVERLAP;
}

/** Is this body one the gate judges by meaning, given a vector? */
function judgedByMeaning(oldBody: string | undefined): boolean {
  return lines(oldBody).length > SHORT_BODY_MAX_LINES && words(oldBody).length >= JUDGEABLE_MIN_WORDS;
}

/** The body test the gate applies: by meaning for a body long enough to carry
 *  one, when a similarity is known; by lines and words otherwise. */
export function bodyReplaced(
  oldBody: string | undefined,
  newBody: string | undefined,
  cosine?: number,
  maxCosine = REPLACE_MAX_COSINE,
): boolean {
  if (cosine === undefined || !judgedByMeaning(oldBody)) return bodyWhollyReplaced(oldBody, newBody);
  return cosine <= maxCosine;
}

/** Does this pair reach the body test at all? A swap replaces one real
 *  document with another: if either side is empty it is a stub being filled in
 *  or a document being blanked, and the same title — including one respelled
 *  around its separators — is an ordinary edit, whatever happened to the body. */
export function isRetitleCandidate(main: SwapNode, prev: SwapNode): boolean {
  // The title first: nearly every document keeps it, and comparing two titles
  // costs far less than normalising two bodies.
  if (sameTitle(main.title, prev.title)) return false;
  return !!norm(main.content) && !!norm(prev.content);
}

/** Would the gate consult a similarity for this pair? The caller uses it to
 *  fetch vectors for these documents only: the pairs detectIdentitySwaps takes
 *  to bodyReplaced with a body of the right size. */
export function wantsSimilarity(main: SwapNode | undefined, prev: SwapNode | undefined): boolean {
  return !!main && !!prev && isRetitleCandidate(main, prev) && judgedByMeaning(main.content);
}
