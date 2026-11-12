/**
 * Per-commit document events: two snapshots of the atlas (atlas-git-source.ts)
 * → what happened to each document, and that document's diff body. The live
 * history walk (build-history) and a preview's commit history both read events
 * from here, so a commit row means the same thing on either side.
 *
 * PR metadata, bullet matching and row keys stay with the caller: they belong to
 * where the commit came from, not to what it changed.
 */

import { lineDiff } from "../../src/lib/diffCore.ts";
import type { DiffLine } from "../../src/lib/history.ts";
import type { GitSnapshot, GitSnapshotEntry } from "./atlas-git-parse.ts";
import { classifyDiff } from "./history-classify.mjs";

/** `renumbered`: the doc number changed. `retyped`: the heading's `[Type]` changed.
 *  Neither changes content, title or path inside a composed bucket file, so each is
 *  its own event, beside any edit or move in the same commit. */
export type ChangeType = "added" | "modified" | "removed" | "moved" | "renumbered" | "retyped";

export type EventNode = GitSnapshotEntry & {
  id: string;
  prevTitle?: string;
  movedFrom?: string;
  movedTo?: string;
  /** On a `renumbered` node: the doc number before. */
  prevDocNo?: string;
  /** On a `retyped` node: the `[Type]` before. */
  prevType?: string;
};

export interface SnapshotEvent {
  node: EventNode;
  changeType: ChangeType;
}

/** The diff body of one event, in the field order history entries carry. */
export interface EventDiff {
  diff?: DiffLine[];
  changeKind?: string;
  movedFrom?: string;
  movedTo?: string;
}

/** Lines past this are cut to a single "…" in an added or removed body. */
const WHOLE_BODY_MAX_LINES = 20;

/** prev → curr as six lists. Only `added` and `removed` exclude the rest: a
 *  document renumbered AND edited in one commit is in `modified` and
 *  `renumbered`, and yields two events, so a renumbering is visible even when
 *  the content did not change. A document with no type on either side (an
 *  unparsed heading) is never `retyped`. */
export function diffSnapshots(prev: GitSnapshot, curr: GitSnapshot) {
  const added: EventNode[] = [], modified: EventNode[] = [], removed: EventNode[] = [], moved: EventNode[] = [];
  const renumbered: EventNode[] = [], retyped: EventNode[] = [];
  for (const [id, node] of curr) {
    const old = prev.get(id);
    if (!old) {
      added.push({ id, ...node });
      continue;
    }
    if (old.contentHash !== node.contentHash || old.title !== node.title) modified.push({ id, ...node, prevTitle: old.title });
    if (old.path && node.path && old.path !== node.path) moved.push({ id, ...node, movedFrom: old.path, movedTo: node.path });
    if (old.doc_no !== node.doc_no) renumbered.push({ id, ...node, prevDocNo: old.doc_no });
    if (old.type && node.type && old.type !== node.type) retyped.push({ id, ...node, prevType: old.type });
  }
  for (const [id, node] of prev) if (!curr.has(id)) removed.push({ id, ...node });
  return { added, modified, removed, moved, renumbered, retyped };
}

/** The six lists as one event list, in added → modified → removed → moved →
 *  renumbered → retyped order. */
export function snapshotEvents(d: ReturnType<typeof diffSnapshots>): SnapshotEvent[] {
  return [
    ...d.added.map((node) => ({ node, changeType: "added" as const })),
    ...d.modified.map((node) => ({ node, changeType: "modified" as const })),
    ...d.removed.map((node) => ({ node, changeType: "removed" as const })),
    ...d.moved.map((node) => ({ node, changeType: "moved" as const })),
    ...d.renumbered.map((node) => ({ node, changeType: "renumbered" as const })),
    ...d.retyped.map((node) => ({ node, changeType: "retyped" as const })),
  ];
}

function wholeBody(text: string, sign: "+" | "-"): DiffLine[] {
  const lines: DiffLine[] = text.split("\n").map((l) => [sign, l]);
  return lines.length > WHOLE_BODY_MAX_LINES ? [...lines.slice(0, WHOLE_BODY_MAX_LINES), ["…"]] : lines;
}

function modifiedDiff(before: GitSnapshotEntry | undefined, after: GitSnapshotEntry | undefined, kindHint?: string | null): EventDiff {
  const diff = lineDiff(before?.content ?? "", after?.content ?? "");
  if (!diff.length) return {};
  const kind = kindHint ?? classifyDiff(diff);
  return kind ? { diff, changeKind: kind } : { diff };
}

/** One event's diff body. A modification gets a line/word diff and a kind
 *  (`kindHint` wins over the diff's own classification); a document added
 *  `midHistory` gets its whole body, since one added at the very first atlas
 *  commit would only repeat the atlas; a removal gets the body it lost; a move
 *  gets its old and new paths; a renumbering its old and new doc numbers, and a
 *  type change its old and new types, in the same two fields. */
export function eventDiff(
  ev: SnapshotEvent,
  prev: GitSnapshot,
  curr: GitSnapshot,
  opts: { midHistory: boolean; kindHint?: string | null },
): EventDiff {
  const id = ev.node.id;
  if (ev.changeType === "modified") return modifiedDiff(prev.get(id), curr.get(id), opts.kindHint);
  if (ev.changeType === "added") {
    const body = curr.get(id)?.content ?? "";
    return opts.midHistory && body ? { diff: wholeBody(body, "+") } : {};
  }
  if (ev.changeType === "removed") {
    const body = prev.get(id)?.content ?? "";
    return body ? { diff: wholeBody(body, "-") } : {};
  }
  if (ev.changeType === "renumbered") return { movedFrom: ev.node.prevDocNo, movedTo: ev.node.doc_no };
  if (ev.changeType === "retyped") return { movedFrom: ev.node.prevType, movedTo: ev.node.type };
  return { movedFrom: ev.node.movedFrom, movedTo: ev.node.movedTo };
}
