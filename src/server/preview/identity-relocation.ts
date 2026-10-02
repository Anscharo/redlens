// Where did the displaced content go? Finding it is what turns "rewritten"
// into "identity changed", and what overrides every rename rule. Pure.

import { norm, orderedWordContainment, words } from "./identity-text.ts";
import type { SwapNode } from "./identity-types.ts";

// The displaced content should reappear inside its new home in order and
// (nearly) in full, tolerating subword typo fixes and text the move added.
// Ordered containment, NOT a bag of words: a loose word-overlap heuristic gave
// a ~22% false-positive rate over the live atlas, matching shared boilerplate
// like "Completed Instances Directory" / "Failed Invocations".
export const RELOCATION_MIN_CHARS = 25; // old content must be this distinctive
export const RELOCATION_MIN_WORDS = 4; // …and carry at least this many words
// 0.95 (not 0.9) so a real word substitution between near-duplicate template
// docs ("Fluid" vs "Securitize") drops below the bar, while a subword typo —
// which still fuzzy-equals its word — stays counted.
export const RELOCATION_MIN_RATIO = 0.95;

/** Find where the displaced (old) content went. Conservative by design — a wrong
 *  match puts a misleading "moved to" link on the swap AND a false ⚠ on an
 *  innocent new doc, so we only claim a relocation when the evidence is strong:
 *    1. the old content is distinctive (>= RELOCATION_MIN_CHARS / _MIN_WORDS);
 *    2. it is NOT boilerplate — it appears in only the one live doc being swapped,
 *       not repeated across the atlas (no single "moved to" otherwise);
 *    3. (nearly) all of it reappears, in order, in EXACTLY ONE added doc
 *       (>= RELOCATION_MIN_RATIO, typo-tolerant); two or more matches is
 *       ambiguous, so we decline.
 *  Returns null (swap still flagged, just without a movedTo link) when unsure. */
export function relocationTarget(
  oldContent: string | undefined,
  mainById: Map<string, SwapNode>,
  addedIds: string[],
  previewById: Map<string, SwapNode>,
): SwapNode | null {
  const o = norm(oldContent);
  if (o.length < RELOCATION_MIN_CHARS || words(oldContent).length < RELOCATION_MIN_WORDS) return null;
  // Boilerplate guard: if the old content also appears verbatim in another live
  // doc, it's shared template text with no single destination.
  let mainHits = 0;
  for (const m of mainById.values()) {
    if (norm(m.content).includes(o) && ++mainHits > 1) return null;
  }
  // (Nearly) all of the old content, in order, in exactly one added doc.
  let match: SwapNode | null = null;
  for (const aid of addedIds) {
    const cand = previewById.get(aid);
    if (cand && orderedWordContainment(oldContent, cand.content) >= RELOCATION_MIN_RATIO) {
      if (match) return null; // ambiguous — more than one home
      match = cand;
    }
  }
  return match;
}
