// What one branch commit did to each document, as rows the reader's history
// tab renders. Built on the live history's own engine (history-events.ts), so a
// commit row here means what it means on the live atlas, with one addition a
// branch needs: a merge commit keeps only the documents where both sides' edits met.

import { diffSnapshots, eventDiff, snapshotEvents, type ChangeType, type EventDiff, type SnapshotEvent } from "../../../scripts/lib/history-events.ts";
import type { GitSnapshot, GitSnapshotEntry } from "../../../scripts/lib/atlas-git-parse.ts";

export interface CommitEntry extends EventDiff {
  changeType: ChangeType;
  docNo: string;
  title: string;
  prevDocNo?: string;
  /** On a `retitled` row: the title before. */
  prevTitle?: string;
  /** On a `retyped` row: the `[Type]` before and after. */
  docType?: string;
  prevDocType?: string;
  /** On a merge commit: the merged state matches neither parent, so edits from
   *  both sides met in this document (combined by git, or resolved by hand). */
  bothSides?: true;
}

/** uuid → that document's rows for one commit (a modification and a move can share a commit). */
export type CommitEntries = Record<string, CommitEntry[]>;

function push(out: CommitEntries, id: string, e: CommitEntry): void {
  (out[id] ??= []).push(e);
}

/** One event as a row. The wire names a retitling's, a renumbering's and a type
 *  change's two values for what they are, not as the engine's movedFrom/movedTo. */
function entryOf(ev: SnapshotEvent, prev: GitSnapshot, curr: GitSnapshot): CommitEntry {
  const { doc_no, title, type, movedFrom } = ev.node;
  const base = { changeType: ev.changeType, docNo: doc_no, title };
  if (ev.changeType === "retitled") return { ...base, prevTitle: movedFrom };
  if (ev.changeType === "renumbered") return { ...base, prevDocNo: movedFrom };
  if (ev.changeType === "retyped") return { ...base, docType: type, prevDocType: movedFrom };
  return { ...base, ...eventDiff(ev, prev, curr, { midHistory: true }) };
}

/** Every document event from `prev` to `curr`. */
export function commitEntries(prev: GitSnapshot, curr: GitSnapshot): CommitEntries {
  const out: CommitEntries = {};
  for (const ev of snapshotEvents(diffSnapshots(prev, curr))) push(out, ev.node.id, entryOf(ev, prev, curr));
  return out;
}

const stateOf = (e: GitSnapshotEntry | undefined) => (e ? `${e.doc_no}\0${e.title}\0${e.type}\0${e.contentHash}` : "");

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
