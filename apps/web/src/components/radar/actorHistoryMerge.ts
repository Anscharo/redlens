// React-free half of the Radar actor history panel: how per-doc history merges
// into per-commit rows (which docs count as relevant is actorHistoryCategories.ts).
import { foldRestatedEntries, movePaths, type HistoryEntry } from "@/lib/history";
import type { AtlasNode } from "@/types";

export type Category = "definition" | "instance" | "param" | "primitive" | "reward" | "config";
export type ChangeKind = "lint" | "typo" | "semantic";

export interface AffectedDoc {
  docId: string;
  docNo: string | null;
  title: string | null;
  category: Category;
  changeType: HistoryEntry["changeType"];
  /** Edit significance for modified entries — lets the UI mute trivial rows */
  changeKind?: ChangeKind;
  /** For a genuine `moved` event: the path (or html-era doc_no) before and
   *  after. Absent for a self-move (movedFrom === movedTo — only the title or
   *  ancestors changed, not the doc_no) so the UI never renders a nonsense
   *  "moved from X to X". */
  movedFrom?: string;
  movedTo?: string;
  /** For a `retitled` event: the title before and after. */
  retitled?: [string, string];
  /** For a `renumbered` event: the doc number before and after. */
  renumbered?: [string, string];
  /** For a `retyped` event: the `[Type]` before and after. */
  retyped?: [string, string];
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

// Structural events (moves, renumberings, type changes) surface like any other
// change, but guard the self-move quirk: some rows record movedFrom === movedTo
// because only the title/ancestors changed, not the doc_no, so the from/to
// detail is attached only when the paths differ. Each detail merges onto
// `affected` whether the row was just created or already existed (e.g. created
// by a same-commit "modified" event), so it survives whichever of a doc's
// same-commit events is processed first.
function attachMoveDetail(affected: AffectedDoc, entry: HistoryEntry): void {
  const pair = entry.movedFrom && entry.movedTo ? ([entry.movedFrom, entry.movedTo] as [string, string]) : undefined;
  if (entry.changeType === "retitled") affected.retitled = pair;
  if (entry.changeType === "renumbered") affected.renumbered = pair;
  if (entry.changeType === "retyped") affected.retyped = pair;
  if (entry.changeType !== "moved") return;
  const move = movePaths(entry);
  if (move?.from && move.to && move.from !== move.to) {
    affected.movedFrom = move.from;
    affected.movedTo = move.to;
  }
}

// Rows are keyed per commit (mirroring byCommit's own keying). A doc can carry
// several events in the same commit — the history builder emits "retitled",
// "modified", "moved", "renumbered" and "retyped" events independently
// (scripts/lib/history-events.ts). Keying rows through this map lets the second event for a
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

// Which of a doc's same-commit events names its row: a content event beats a
// retitling, which beats a type change, which beats a renumbering, which beats a
// bare move (edit significance says more than a structural change).
const RANK: Record<HistoryEntry["changeType"], number> = { moved: 0, renumbered: 1, retyped: 2, retitled: 3, added: 4, modified: 4, removed: 4 };

function upsertAffected({ commitEntry, rows }: CommitGroup, doc: DocRef, entry: HistoryEntry): void {
  let affected = rows.get(doc.docId);
  if (!affected) {
    affected = newAffected(doc, entry);
    rows.set(doc.docId, affected);
    commitEntry.docs.push(affected);
  } else if (RANK[entry.changeType] > RANK[affected.changeType]) {
    // The details are merged below independently of this branch, so arrival
    // order does not matter.
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
    // Fold per doc first, as the reader's history does, so an entry another one
    // restates never names the row.
    for (const entry of foldRestatedEntries(entries)) {
      upsertAffected(commitGroup(byCommit, rowsByCommit, entry), { docId, category, node: docs[docId] }, entry);
    }
  }
  return [...byCommit.values()].sort((a, b) => b.date.localeCompare(a.date));
}
