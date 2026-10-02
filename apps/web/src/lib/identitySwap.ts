import type { IdentitySwap } from "./previewDiff";

/** Was the displaced content FOUND under a new UUID? Only then is "this UUID
 *  now holds a different document" demonstrated, and only then does the reader
 *  warn. Without it the swap is described as a rewrite. One test, so that the
 *  tree mark and the history panel cannot disagree. */
export function isReassigned(swap: IdentitySwap | undefined): swap is IdentitySwap & { movedTo: NonNullable<IdentitySwap["movedTo"]> } {
  return !!swap?.movedTo;
}
