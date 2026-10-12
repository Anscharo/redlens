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

export type ChangeType = "added" | "modified" | "removed" | "moved";

export type EventNode = GitSnapshotEntry & { id: string; prevTitle?: string; movedFrom?: string; movedTo?: string };

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

/** prev → curr as four lists. `moved` is independent of `modified`: a document
 *  renumbered AND edited in one commit is in both, and yields two events, so a
 *  renumbering is visible even when the content did not change. */
export function diffSnapshots(prev: GitSnapshot, curr: GitSnapshot) {
  const added: EventNode[] = [], modified: EventNode[] = [], removed: EventNode[] = [], moved: EventNode[] = [];
  for (const [id, node] of curr) {
    const old = prev.get(id);
    if (!old) {
      added.push({ id, ...node });
      continue;
    }
    if (old.contentHash !== node.contentHash || old.title !== node.title) modified.push({ id, ...node, prevTitle: old.title });
    if (old.path && node.path && old.path !== node.path) moved.push({ id, ...node, movedFrom: old.path, movedTo: node.path });
  }
  for (const [id, node] of prev) if (!curr.has(id)) removed.push({ id, ...node });
  return { added, modified, removed, moved };
}

/** The four lists as one event list, in added → modified → removed → moved order. */
export function snapshotEvents(d: ReturnType<typeof diffSnapshots>): SnapshotEvent[] {
  return [
    ...d.added.map((node) => ({ node, changeType: "added" as const })),
    ...d.modified.map((node) => ({ node, changeType: "modified" as const })),
    ...d.removed.map((node) => ({ node, changeType: "removed" as const })),
    ...d.moved.map((node) => ({ node, changeType: "moved" as const })),
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
 *  gets its old and new paths. */
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
  return { movedFrom: ev.node.movedFrom, movedTo: ev.node.movedTo };
}
