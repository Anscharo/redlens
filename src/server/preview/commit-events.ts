// What one branch commit did to each document, as rows the reader's history
// tab renders. Built on the live history's own engine (history-events.ts), so a
// commit row here means what it means on the live atlas, with two additions a
// branch needs: a renumbering is its own event (inside a composed bucket file
// it changes no content, title or path, so the shared engine never reports it),
// and a merge commit keeps only the documents where both sides' edits met.

import { diffSnapshots, eventDiff, snapshotEvents, type ChangeType, type EventDiff } from "../../../scripts/lib/history-events.ts";
import type { GitSnapshot, GitSnapshotEntry } from "../../../scripts/lib/atlas-git-parse.ts";

export interface CommitEntry extends EventDiff {
  changeType: ChangeType | "renumbered";
  docNo: string;
  title: string;
  prevDocNo?: string;
  prevTitle?: string;
  /** On a merge commit: the merged state matches neither parent, so edits from
   *  both sides met in this document (combined by git, or resolved by hand). */
  bothSides?: true;
}

/** uuid → that document's rows for one commit (a modification and a move can share a commit). */
export type CommitEntries = Record<string, CommitEntry[]>;

function push(out: CommitEntries, id: string, e: CommitEntry): void {
  (out[id] ??= []).push(e);
}

/** Every document event from `prev` to `curr`. */
export function commitEntries(prev: GitSnapshot, curr: GitSnapshot): CommitEntries {
  const out: CommitEntries = {};
  for (const ev of snapshotEvents(diffSnapshots(prev, curr))) {
    const { id, doc_no, title, prevTitle } = ev.node;
    const entry: CommitEntry = { changeType: ev.changeType, docNo: doc_no, title, ...eventDiff(ev, prev, curr, { midHistory: true }) };
    if (prevTitle !== undefined && prevTitle !== title) entry.prevTitle = prevTitle;
    push(out, id, entry);
  }
  for (const [id, node] of curr) {
    const old = prev.get(id);
    if (old && old.doc_no !== node.doc_no) push(out, id, { changeType: "renumbered", docNo: node.doc_no, title: node.title, prevDocNo: old.doc_no });
  }
  return out;
}

const stateOf = (e: GitSnapshotEntry | undefined) => (e ? `${e.doc_no}\0${e.title}\0${e.contentHash}` : "");

/** A merge commit's rows: only documents whose merged state matches no parent.
 *  Everything else the merge carries was settled on one side already: either in
 *  commits on this branch, which have rows of their own, or on the base. */
export function mergeEntries(parents: GitSnapshot[], curr: GitSnapshot): CommitEntries {
  const ids = new Set<string>([...curr.keys(), ...parents.flatMap((p) => [...p.keys()])]);
  const met = [...ids].filter((id) => parents.every((p) => stateOf(p.get(id)) !== stateOf(curr.get(id))));
  if (!met.length) return {};
  const all = commitEntries(parents[0], curr);
  const out: CommitEntries = {};
  for (const id of met) if (all[id]) out[id] = all[id].map((e) => ({ ...e, bothSides: true as const }));
  return out;
}
