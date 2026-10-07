// React-free half of the Radar actor history panel: how per-doc history merges
// into per-commit rows (which docs count as relevant is actorHistoryCategories.ts).
import { movePaths, type HistoryEntry } from "@/lib/history";
import type { AtlasNode } from "@/types";

export type Category = "definition" | "instance" | "param" | "primitive" | "reward" | "config";
export type ChangeKind = "lint" | "typo" | "semantic";

export interface AffectedDoc {
  docId: string;
  docNo: string | null;
  title: string | null;
  category: Category;
  changeType: "added" | "modified" | "removed" | "moved";
  /** Edit significance for modified entries — lets the UI mute trivial rows */
  changeKind?: ChangeKind;
  /** For a genuine `moved` (renumber/atomization) event: the doc_no before and
   *  after. Absent for a self-move (movedFrom === movedTo — only the title or
   *  ancestors changed, not the doc_no) so the UI never renders a nonsense
   *  "moved from X to X". */
  movedFrom?: string;
  movedTo?: string;
}

export interface MergedEntry {
  date: string;
  commitHash: string;
  pr?: number;
  prTitle?: string;
  prAuthor?: string;
  prUrl?: string;
  /** Reconstructed pre-git eras (mip/genesis/severed) share one synthetic commitHash
   *  across every doc that cites it, so era is a per-commit property here — same for
   *  every entry merged into this group. Absent for real git commits. */
  era?: string;
  docs: AffectedDoc[];
}

// "moved" events (renumbers, atomization) surface like any other structural
// change, but guard the self-move quirk: some rows record movedFrom === movedTo
// because only the title/ancestors changed, not the doc_no, so the from/to
// detail is attached only when the paths differ. It merges onto `affected`
// whether the row was just created or already existed (e.g. created by a
// same-commit "modified" event), so a doc's move detail survives whichever of
// its two same-commit events is processed first.
function attachMoveDetail(affected: AffectedDoc, entry: HistoryEntry): void {
  if (entry.changeType !== "moved") return;
  const move = movePaths(entry);
  if (move?.from && move.to && move.from !== move.to) {
    affected.movedFrom = move.from;
    affected.movedTo = move.to;
  }
}

// Rows are keyed per commit (mirroring byCommit's own keying). A doc can carry
// BOTH a "modified" and a "moved" event in the same commit — the history builder
// emits both when a node is edited and renumbered together
// (scripts/required/build-history.mjs: "A node can appear twice ... both entries
// are emitted"). Keying rows through this map lets the second event for a
// (commit, docId) pair merge onto the first one's row instead of being dropped,
// so neither the changeKind nor the movedFrom/movedTo detail is lost whichever
// event the batch query returns first.
interface CommitGroup {
  commitEntry: MergedEntry;
  rows: Map<string, AffectedDoc>;
}

function newCommitEntry(entry: HistoryEntry): MergedEntry {
  return {
    date: entry.date,
    commitHash: entry.commitHash,
    pr: entry.pr,
    prTitle: entry.prTitle,
    prAuthor: entry.prAuthor,
    prUrl: entry.prUrl,
    era: entry.era,
    docs: [],
  };
}

function commitGroup(
  byCommit: Map<string, MergedEntry>,
  rowsByCommit: Map<string, Map<string, AffectedDoc>>,
  entry: HistoryEntry,
): CommitGroup {
  const commitEntry = byCommit.get(entry.commitHash);
  const rows = rowsByCommit.get(entry.commitHash);
  if (commitEntry && rows) return { commitEntry, rows };
  const fresh: CommitGroup = { commitEntry: newCommitEntry(entry), rows: new Map() };
  byCommit.set(entry.commitHash, fresh.commitEntry);
  rowsByCommit.set(entry.commitHash, fresh.rows);
  return fresh;
}

interface DocRef {
  docId: string;
  category: Category;
  node: AtlasNode | undefined;
}

function newAffected(doc: DocRef, entry: HistoryEntry): AffectedDoc {
  return {
    docId: doc.docId,
    docNo: doc.node?.doc_no ?? null,
    title: doc.node?.title ?? null,
    category: doc.category,
    changeType: entry.changeType,
    changeKind: entry.changeKind,
  };
}

function upsertAffected({ commitEntry, rows }: CommitGroup, doc: DocRef, entry: HistoryEntry): void {
  let affected = rows.get(doc.docId);
  if (!affected) {
    affected = newAffected(doc, entry);
    rows.set(doc.docId, affected);
    commitEntry.docs.push(affected);
  } else if (entry.changeType !== "moved") {
    // A content-edit event landing on a row a same-commit "moved" event
    // already created: the edit is the more informative primary indicator
    // (edit significance beats a bare "renumbered"), so it takes over
    // changeType/changeKind. The move detail is merged below independently
    // of this branch, so arrival order does not matter.
    affected.changeType = entry.changeType;
    affected.changeKind = entry.changeKind;
  }
  attachMoveDetail(affected, entry);
}

export function mergeByCommit(
  perDoc: ReadonlyArray<readonly [string, HistoryEntry[]]>,
  docCategory: Map<string, Category>,
  docs: Record<string, AtlasNode>,
): MergedEntry[] {
  const byCommit = new Map<string, MergedEntry>();
  const rowsByCommit = new Map<string, Map<string, AffectedDoc>>();
  for (const [docId, entries] of perDoc) {
    const category = docCategory.get(docId);
    if (!category) continue;
    for (const entry of entries) {
      upsertAffected(commitGroup(byCommit, rowsByCommit, entry), { docId, category, node: docs[docId] }, entry);
    }
  }
  return [...byCommit.values()].sort((a, b) => b.date.localeCompare(a.date));
}
