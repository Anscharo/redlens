// Pure computation + disk-write for a preview build's two diff artifacts:
// diff.json (added/changed ids — eager, drives markers) and patches.json (id →
// DiffLine[] — lazy, drives preview history). Split out of build.ts (which
// otherwise grows past its intended size) so the diff logic is testable
// without driving a full build.
//
// `base`/`head`/`reference` are three separate snapshots on purpose: `base` is
// the merge base (or live main when there isn't one — see build.ts), `head` is
// this preview's own built docs.json, and `reference` is the snapshot the
// reader compares against — live main for the sky candidate, the candidate's
// own merge base for the repo candidate (so upstream drift never appears
// inside a patch). `added`/`changed` come from diffSnapshots(base, head); the
// rendered patch and the renumbered/retitled fields compare against
// `reference` (what the reader is looking at on screen right now, or the
// candidate's own base), falling back to `base` only when a changed doc isn't
// on `reference` at all (class 4: it was never there, or has since been
// removed).

import fs from "node:fs";
import path from "node:path";
import { contentDiff } from "./patch-diff.ts";
import { diffSnapshots, type Snapshot } from "./snapshot.ts";
import { typeChanged } from "../../../scripts/lib/history-events.ts";
import type { DiffLine } from "../../lib/history";
import { detectIdentitySwaps, type IdentitySwap, type FormerUuid } from "./identity.ts";
import { diffSides, findRenumberedOnly } from "./renumber-only.ts";

export interface PreviewDiffJson {
  added: string[];
  changed: string[];
  /** In the base, gone from the head. Absent on bundles built before it was recorded. */
  removed?: string[];
  renumbered: Record<string, [string, string]>;
  /** Changed docs whose only change is the doc number (renumber-only.ts).
   *  Absent on bundles built before it was recorded. */
  renumberedOnly?: string[];
  retitled: Record<string, [string, string]>;
  /** Changed docs whose `[Type]` differs: id → [before, after]. Absent on bundles built before it was recorded. */
  retyped?: Record<string, [string, string]>;
  reusedSlot: Record<string, { title: string; movedTo?: string }>;
  identitySwap: Record<string, IdentitySwap>;
  formerUuid: Record<string, FormerUuid>;
}

function pureAdditions(ids: Iterable<string>, head: Snapshot, patches: Record<string, DiffLine[]>) {
  for (const id of ids) {
    const dl = contentDiff("", head.get(id)?.content ?? "");
    if (dl.length) patches[id] = dl;
  }
}

function changedSides(changed: string[], base: Snapshot, head: Snapshot, reference: Snapshot, patches: Record<string, DiffLine[]>) {
  const renumbered: Record<string, [string, string]> = {};
  const retitled: Record<string, [string, string]> = {};
  const retyped: Record<string, [string, string]> = {};
  for (const id of changed) noteChanged(id, base, head, reference, patches, renumbered, retitled, retyped);
  return { renumbered, retitled, retyped };
}

function noteChanged(
  id: string,
  base: Snapshot,
  head: Snapshot,
  reference: Snapshot,
  patches: Record<string, DiffLine[]>,
  renumbered: Record<string, [string, string]>,
  retitled: Record<string, [string, string]>,
  retyped: Record<string, [string, string]>,
) {
  const beforeNode = reference.get(id) ?? base.get(id);
  const afterNode = head.get(id);
  if (!beforeNode || !afterNode) return;
  const dl = contentDiff(beforeNode.content ?? "", afterNode.content ?? "");
  if (dl.length) patches[id] = dl;
  if (beforeNode.doc_no !== afterNode.doc_no) renumbered[id] = [beforeNode.doc_no, afterNode.doc_no];
  if (beforeNode.title !== afterNode.title) retitled[id] = [beforeNode.title ?? "", afterNode.title ?? ""];
  if (typeChanged(beforeNode, afterNode)) retyped[id] = [beforeNode.type!, afterNode.type!];
}

function reusedSlots(added: string[], head: Snapshot, reference: Snapshot, patches: Record<string, DiffLine[]>) {
  const referenceDocNos = new Map<string, string>();
  for (const [rid, rnode] of reference) referenceDocNos.set(rnode.doc_no, rid);
  const reusedSlot: Record<string, { title: string; movedTo?: string }> = {};
  for (const id of added) noteReuse(id, head, reference, referenceDocNos, reusedSlot, patches);
  return reusedSlot;
}

function noteReuse(
  id: string,
  head: Snapshot,
  reference: Snapshot,
  referenceDocNos: Map<string, string>,
  reusedSlot: Record<string, { title: string; movedTo?: string }>,
  patches: Record<string, DiffLine[]>,
) {
  const node = head.get(id);
  if (!node) return;
  const occupant = referenceDocNos.get(node.doc_no);
  if (!occupant || occupant === id) return;
  reusedSlot[id] = { title: reference.get(occupant)?.title ?? occupant.slice(0, 8), movedTo: head.get(occupant)?.doc_no };
  const dl = contentDiff("", node.content ?? "");
  if (dl.length) patches[id] = dl;
  else delete patches[id];
}

export function computeDiffArtifacts(
  base: Snapshot,
  head: Snapshot,
  reference: Snapshot,
): { diff: PreviewDiffJson; patches: Record<string, DiffLine[]> } {
  const { added, changed, removed } = diffSnapshots(base, head);
  const patches: Record<string, DiffLine[]> = {};
  pureAdditions(added, head, patches);
  const { renumbered, retitled, retyped } = changedSides(changed, base, head, reference, patches);
  const reusedSlot = reusedSlots(added, head, reference, patches);
  const { identitySwap, formerUuid } = detectIdentitySwaps({ changed, added, mainById: reference, previewById: head });
  const renumberedOnly = findRenumberedOnly(changed, diffSides(base, head, reference));
  return {
    diff: { added, changed, removed, renumbered, renumberedOnly, retitled, retyped, reusedSlot, identitySwap, formerUuid },
    patches,
  };
}

export function writeDiffArtifacts(
  outDir: string,
  a: { diff: PreviewDiffJson; patches: Record<string, DiffLine[]> },
): void {
  fs.writeFileSync(path.join(outDir, "diff.json"), JSON.stringify(a.diff));
  fs.writeFileSync(path.join(outDir, "patches.json"), JSON.stringify(a.patches));
}
