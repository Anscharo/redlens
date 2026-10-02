// Detect UUID-identity reassignments in a preview's diff.
//
// The diff pipeline keys docs by UUID. When a fork keeps a UUID (and usually its
// doc number too) but swaps the underlying *document* — a different title and an
// almost entirely rewritten body — the plain added/changed split records it as
// an ordinary "changed" edit. That badly undersells the change: a stable
// identity now points at a different document. This module flags that case and,
// best-effort, finds where the displaced (old) content went, so both sides of
// the swap can carry a warning marker.
//
// Pure (no IO). This file is the gate itself; each rule it applies has a file
// of its own, and everything is re-exported here so callers import one module:
//
//   identity-text.ts        lines and words: how much of a text survives
//   identity-titles.ts      same title, related titles, title substitutions
//   identity-body.ts        the body test and its bars
//   identity-rename.ts      renamed in place, and bulk renames
//   identity-relocation.ts  where the displaced content went
//   identity-types.ts       the shapes
//
// Why each bar has its value: docs/research/identity-swap-detection.md.

import { bodyReplaced, isRetitleCandidate } from "./identity-body.ts";
import { relocationTarget } from "./identity-relocation.ts";
import { renameCampaigns, renameScore, RENAME_MIN_KEPT } from "./identity-rename.ts";
import { titlesRelated } from "./identity-titles.ts";
import type { BodySimilarity, FormerUuid, IdentitySwap, SwapNode } from "./identity-types.ts";

export type * from "./identity-types.ts";
export * from "./identity-text.ts";
export * from "./identity-titles.ts";
export * from "./identity-body.ts";
export * from "./identity-rename.ts";
export * from "./identity-relocation.ts";

/** Classify identity swaps in a computed diff. `changed`/`added` are the UUID
 *  sets from mapChangedDocs; the maps are keyed by UUID for the live atlas and
 *  this preview respectively. */
export function detectIdentitySwaps(args: {
  changed: Iterable<string>;
  added: Iterable<string>;
  mainById: Map<string, SwapNode>;
  previewById: Map<string, SwapNode>;
  /** Optional: see BodySimilarity. Absent, every body is judged by lines and words. */
  similarity?: BodySimilarity;
  /** The cosine bar for the model behind `similarity` (replaceMaxCosineFor). */
  maxCosine?: number;
}): { identitySwap: Record<string, IdentitySwap>; formerUuid: Record<string, FormerUuid> } {
  const { changed, added, mainById, previewById, similarity, maxCosine } = args;
  const identitySwap: Record<string, IdentitySwap> = {};
  const formerUuid: Record<string, FormerUuid> = {};
  const addedIds = [...added];
  // Read once: `changed` is walked twice below, and an iterator (a Map's
  // keys()) would be spent by the first walk.
  const changedIds = [...changed];
  const renamed = renameCampaigns({ changed: changedIds, mainById, previewById });

  for (const id of changedIds) {
    const main = mainById.get(id);
    const prev = previewById.get(id);
    if (!main || !prev || !isRetitleCandidate(main, prev)) continue;
    if (!bodyReplaced(main.content, prev.content, similarity?.(id), maxCosine)) continue; // body largely preserved → edit

    const moved = relocationTarget(main.content, mainById, addedIds, previewById);
    // Three ways the title shows a rename and not a swap. Each yields to a
    // demonstrated relocation: old content found under a new UUID means this
    // one really was repurposed.
    //   - one title contains the other ("…Agent" → "…Agent Ozone"): a refinement;
    //   - other documents in this diff took the identical title edit: a bulk
    //     rename, a fact about the PR that no single document can see;
    //   - the body changed only by the substitution the title made: an entity
    //     rename, which needs no second document to show itself.
    const isRename = () =>
      titlesRelated(main.title, prev.title) || renamed.has(id) || (renameScore(main, prev) ?? 0) >= RENAME_MIN_KEPT;
    if (!moved && isRename()) continue;

    const swap: IdentitySwap = { oldTitle: main.title ?? "", newTitle: prev.title ?? "" };
    if (moved) {
      swap.movedTo = { id: moved.id, doc_no: moved.doc_no, title: moved.title ?? "" };
      formerUuid[moved.id] = { previousId: id, previousTitle: main.title ?? "", previousDocNo: main.doc_no };
    }
    identitySwap[id] = swap;
  }
  return { identitySwap, formerUuid };
}
