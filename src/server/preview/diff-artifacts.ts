// Pure computation + disk-write for a preview build's two diff artifacts:
// diff.json (added/changed ids — eager, drives markers) and patches.json (id →
// DiffLine[] — lazy, drives preview history). Split out of build.ts (which
// otherwise grows past its intended size) so the diff logic is testable
// without driving a full build.
//
// `base`/`head`/`live` are three separate snapshots on purpose: `base` is the
// merge base (or live main when there isn't one — see build.ts), `head` is
// this preview's own built docs.json, and `live` is the CURRENTLY SERVED main
// atlas. `added`/`changed` come from diffSnapshots(base, head); the rendered
// patch and the renumbered/retitled fields compare against LIVE (what the
// reader is looking at on screen right now), falling back to `base` only when
// a changed doc isn't on live at all (class 4: main never had it, or it has
// since been removed there).

import fs from "node:fs";
import path from "node:path";
import { contentDiff } from "./patch-diff.ts";
import { diffSnapshots, type Snapshot } from "./snapshot.ts";
import type { DiffLine } from "../../lib/history";
import { detectIdentitySwaps, type IdentitySwap, type FormerUuid } from "./identity.ts";

export interface PreviewDiffJson {
  added: string[];
  changed: string[];
  renumbered: Record<string, [string, string]>;
  retitled: Record<string, [string, string]>;
  reusedSlot: Record<string, { title: string; movedTo?: string }>;
  identitySwap: Record<string, IdentitySwap>;
  formerUuid: Record<string, FormerUuid>;
}

export function computeDiffArtifacts(
  base: Snapshot,
  head: Snapshot,
  live: Snapshot,
): { diff: PreviewDiffJson; patches: Record<string, DiffLine[]> } {
  // Which docs this preview adds/changes, by DOCUMENT IDENTITY rather than by
  // changed filename. Filenames stopped identifying documents when the atlas
  // consolidated ~11k document.md files into ~16 composed files (upstream
  // #294) — one changed file now spans a whole Scope. Comparing uuid-keyed
  // snapshots is layout-blind, so it survives that regrouping and the next one.
  const { added, changed } = diffSnapshots(base, head);

  // An ADDED doc has no prior content anywhere — render its body as pure
  // additions. CHANGED docs get their patch from the vs-live identity diff
  // below.
  const patches: Record<string, DiffLine[]> = {};
  for (const id of added) {
    const dl = contentDiff("", head.get(id)?.content ?? "");
    if (dl.length) patches[id] = dl;
  }

  // For CHANGED docs the rendered redline is this uuid's content here vs on
  // the LIVE atlas (what the reader is comparing against on screen), and
  // renumberings/retitles are recorded explicitly. A doc changed vs the merge
  // base but absent from live (removed there, or live never had it) falls
  // back to the base side rather than being skipped — it still needs a patch.
  const renumbered: Record<string, [string, string]> = {};
  const retitled: Record<string, [string, string]> = {};
  for (const id of changed) {
    const beforeNode = live.get(id) ?? base.get(id);
    const afterNode = head.get(id);
    if (!beforeNode || !afterNode) continue;
    // No delete needed on an empty diff: `changed` and `added` are disjoint,
    // so nothing can have written patches[id] before this point.
    const dl = contentDiff(beforeNode.content ?? "", afterNode.content ?? "");
    if (dl.length) patches[id] = dl;
    if (beforeNode.doc_no !== afterNode.doc_no) renumbered[id] = [beforeNode.doc_no, afterNode.doc_no];
    if (beforeNode.title !== afterNode.title) retitled[id] = [beforeNode.title ?? "", afterNode.title ?? ""];
  }

  // ADDED docs in a reused slot (new uuid at a doc number that exists on the
  // live atlas under a different uuid): the GitHub per-path patch shows the
  // old occupant's content being edited away — misleading for a new doc. Flag
  // the reuse and show the doc's own content as pure additions; the old
  // occupant's move shows on its own history entry. Compares vs LIVE, same as
  // the renumber/retitle checks above.
  const liveDocNos = new Map<string, string>();
  for (const [lid, lnode] of live) liveDocNos.set(lnode.doc_no, lid);
  // id → who held this doc number on the live atlas, and where that doc sits
  // in THIS preview (absent = the occupant was removed). Lets the new doc's
  // history reference the old occupant's move (both sides of a slot swap tell
  // the story).
  const reusedSlot: Record<string, { title: string; movedTo?: string }> = {};
  for (const id of added) {
    const node = head.get(id);
    if (!node) continue;
    const occupant = liveDocNos.get(node.doc_no);
    if (occupant && occupant !== id) {
      reusedSlot[id] = {
        title: live.get(occupant)?.title ?? occupant.slice(0, 8),
        movedTo: head.get(occupant)?.doc_no,
      };
      const dl = contentDiff("", node.content ?? "");
      if (dl.length) patches[id] = dl;
      else delete patches[id];
    }
  }

  // UUID-identity reassignment: a stable uuid whose underlying document was
  // wholly replaced (title changed + body rewritten), and — best effort —
  // where the displaced old content moved to. Treated as a distinct WARNING
  // in the UI, not an ordinary +/Δ.
  const { identitySwap, formerUuid } = detectIdentitySwaps({ changed, added, mainById: live, previewById: head });

  return { diff: { added, changed, renumbered, retitled, reusedSlot, identitySwap, formerUuid }, patches };
}

export function writeDiffArtifacts(
  outDir: string,
  a: { diff: PreviewDiffJson; patches: Record<string, DiffLine[]> },
): void {
  fs.writeFileSync(path.join(outDir, "diff.json"), JSON.stringify(a.diff));
  fs.writeFileSync(path.join(outDir, "patches.json"), JSON.stringify(a.patches));
}
