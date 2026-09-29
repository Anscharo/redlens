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
// Replaced, by MEANING: the cosine of the old and new search vectors (Qwen3,
// title + link-stripped body — see embeddings.ts) is at most this.
export const REPLACE_MAX_COSINE = 0.85;
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

/** The body test the gate applies: by meaning for a body long enough to carry
 *  one, when a similarity is known; by lines and words otherwise. */
export function bodyReplaced(oldBody: string | undefined, newBody: string | undefined, cosine?: number): boolean {
  if (cosine === undefined || lines(oldBody).length <= SHORT_BODY_MAX_LINES) return bodyWhollyReplaced(oldBody, newBody);
  if (words(oldBody).length < JUDGEABLE_MIN_WORDS) return false;
  return cosine <= REPLACE_MAX_COSINE;
}

/** Does this pair reach the body test at all? A swap replaces one real
 *  document with another: if either side is empty it is a stub being filled in
 *  or a document being blanked, and the same title — including one respelled
 *  around its separators — is an ordinary edit, whatever happened to the body. */
export function isRetitleCandidate(main: SwapNode, prev: SwapNode): boolean {
  if (!norm(main.content) || !norm(prev.content)) return false;
  return !sameTitle(main.title, prev.title);
}

/** Would the gate consult a similarity for this pair? The caller uses it to
 *  fetch vectors for these documents only: the pairs detectIdentitySwaps takes
 *  to bodyReplaced with a body of the right size. */
export function wantsSimilarity(main: SwapNode | undefined, prev: SwapNode | undefined): boolean {
  if (!main || !prev || !isRetitleCandidate(main, prev)) return false;
  return lines(main.content).length > SHORT_BODY_MAX_LINES && words(main.content).length >= JUDGEABLE_MIN_WORDS;
}
