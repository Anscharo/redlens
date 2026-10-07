// React-free half of the Radar actor history panel: which of an actor's docs
// count as relevant (and why), and how per-doc history merges into per-commit rows.
import { movePaths, type HistoryEntry } from "@/lib/history";
import type { ActorProfile } from "../../lib/actorIndex";
import type { AtlasNode } from "@/types";
import { descendantIds } from "../../lib/instanceDescendants";

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

export function buildDocCategoryMap(
  profile: ActorProfile,
  byParent: Map<string | null, AtlasNode[]>,
): Map<string, Category> {
  const map = new Map<string, Category>();
  // Invocation ICDs feed into history alongside instance ICDs — they're the
  // same kind of governance doc, just at a different lifecycle stage.
  const icds = [...profile.instances, ...profile.invocations];
  // Lowest priority first; later writes override.
  for (const inst of icds) {
    if (inst.primitiveDocId) map.set(inst.primitiveDocId, "primitive");
  }
  if (profile.rewardsAgent?.dr?.primitiveId) map.set(profile.rewardsAgent.dr.primitiveId, "reward");
  if (profile.rewardsAgent?.ib?.primitiveId) map.set(profile.rewardsAgent.ib.primitiveId, "reward");
  // Every doc nested under an instance/invocation root, so subtree edits (rate
  // limits, contract addresses, off-chain params) surface. Written before
  // param/instance/definition so those more-specific categories override a doc
  // that is both a descendant and, say, a param source.
  for (const inst of icds) {
    if (!inst.docId) continue;
    for (const id of descendantIds(inst.docId, byParent)) map.set(id, "config");
  }
  // Param-source docs next so the instance-root override wins if a param
  // points at its own config root (rare but possible).
  for (const inst of icds) {
    for (const p of inst.signalParams) {
      if (p.srcDocId) map.set(p.srcDocId, "param");
    }
  }
  for (const inst of icds) {
    if (inst.docId) map.set(inst.docId, "instance");
  }
  if (profile.definingDoc) map.set(profile.definingDoc.id, "definition");
  return map;
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

export function mergeByCommit(
  perDoc: ReadonlyArray<readonly [string, HistoryEntry[]]>,
  docCategory: Map<string, Category>,
  docs: Record<string, AtlasNode>,
): MergedEntry[] {
  const byCommit = new Map<string, MergedEntry>();
  // docId → its row, scoped per commit (mirrors byCommit's own keying). A doc
  // can carry BOTH a "modified" and a "moved" event in the same commit — the
  // history builder emits both when a node is edited and renumbered together
  // (scripts/required/build-history.mjs: "A node can appear twice ... both
  // entries are emitted"). Keying rows through this map lets the second event
  // for a (commit, docId) pair merge onto the first one's row instead of being
  // dropped, so neither the changeKind nor the movedFrom/movedTo detail is lost
  // whichever event the batch query returns first.
  const rowsByCommit = new Map<string, Map<string, AffectedDoc>>();
  for (const [docId, entries] of perDoc) {
    const category = docCategory.get(docId);
    if (!category) continue;
    for (const entry of entries) {
      let commitEntry = byCommit.get(entry.commitHash);
      let rows = rowsByCommit.get(entry.commitHash);
      if (!commitEntry || !rows) {
        rows = new Map();
        commitEntry = {
          date: entry.date,
          commitHash: entry.commitHash,
          pr: entry.pr,
          prTitle: entry.prTitle,
          prAuthor: entry.prAuthor,
          prUrl: entry.prUrl,
          era: entry.era,
          docs: [],
        };
        byCommit.set(entry.commitHash, commitEntry);
        rowsByCommit.set(entry.commitHash, rows);
      }

      let affected = rows.get(docId);
      if (!affected) {
        affected = {
          docId,
          docNo: docs[docId]?.doc_no ?? null,
          title: docs[docId]?.title ?? null,
          category,
          changeType: entry.changeType,
          changeKind: entry.changeKind,
        };
        rows.set(docId, affected);
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
  }
  return [...byCommit.values()].sort((a, b) => b.date.localeCompare(a.date));
}
