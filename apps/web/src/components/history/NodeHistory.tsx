import { Fragment, useEffect, useState } from "react";
import { loadHistory, PRE_MD_PR, RECONSTRUCTED_ERAS, type HistoryEntry } from "@/lib/history";
import { EntryRow } from "./EntryRow";
import { SeamFooter } from "./SeamFooter";
import { CONTENT_INDENT, TimelineRow } from "./Timeline";

// Before PR #117 (commit 22cc27b5, 2025-11-21) the atlas was a single HTML file
// with no per-doc identities. Two cases:
//  · reconstructed — the pre-#117 per-doc history is now threaded into atlas_history
//    (era="html", plus era="mip"/"genesis"/"severed" further back — docs/plans/
//    pre-git-history.md); hidden by default behind the "View Reconstructed History"
//    toggle, with a disclaimer shown before each reconstructed block.
//  · not reconstructed — no pre-#117 entries were threaded to this doc. SeamFooter says
//    which of the two that is: a reviewed "created at the migration" verdict, or (the
//    common case) that the doc's earlier history could not be traced at all.
// The repo's first commit (2025-05-28) — everything at/after this is real git history;
// everything below it (era mip/genesis/severed) predates git entirely. When older
// origin events exist, this row's "added" label is a lie (it's not the doc's origin,
// just where git-tracked history starts) — relabel it "committed" instead. Commit
// hashes throughout this pipeline are truncated to 7 chars (gitCommitSeq, buildEvents,
// etc.) — 8 would never match and silently disable the relabel.
const ROOT_SHA = "4e931df";

const PRE_GIT_ERAS = new Set(["mip", "genesis", "severed"]);

export function NodeHistory({
  nodeId,
  railAbove = false,
}: {
  nodeId: string;
  /** Something above already draws the timeline (the preview entry + its live-atlas
   *  heading), so this list's first block keeps its upward rail instead of trimming
   *  it — the line reads as one run from the preview down. */
  railAbove?: boolean;
}) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(undefined as unknown as null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setEntries(null);
    loadHistory(nodeId).then((data) => {
      if (cancelled) return;
      setEntries(data);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [nodeId]);

  // Status lines carry no timeline node of their own — indent them to the entry
  // column so they line up with the entry text rather than with the rail.
  const statusStyle = { color: "var(--tan-3)", marginLeft: CONTENT_INDENT };

  if (loading) {
    return (
      <p className="mono text-[11px]" style={statusStyle}>
        loading history…
      </p>
    );
  }

  if (!entries || entries.length === 0) {
    return (
      <p className="mono text-[11px]" style={statusStyle}>
        no history recorded
      </p>
    );
  }

  // Order by commit_seq (real git position for git-derived eras; a reserved negative
  // block for mip/genesis/severed — docs/plans/pre-git-history.md) rather than by date
  // string: a severed-interval birth has NO date at all, and an empty string would
  // sort as "smallest" — after even the earliest MIP date — which is chronologically
  // backwards. commitSeq is populated on every row once ingested; date compare is a
  // defensive fallback only.
  const sorted = [...entries].sort((a, b) =>
    a.commitSeq != null && b.commitSeq != null ? b.commitSeq - a.commitSeq : b.date.localeCompare(a.date),
  );
  const hasReconstructed = sorted.some((e) => e.era && RECONSTRUCTED_ERAS.has(e.era));
  const hasPreGit = sorted.some((e) => e.era && PRE_GIT_ERAS.has(e.era));
  // Always show the full history — reconstructed and pre-git entries included.
  // Each such entry flags its own provenance with an info-icon tooltip (EntryRow),
  // so there is no longer a toggle or interleaved disclaimer blocks.
  const visible = sorted;
  const trimTop = !railAbove;

  return (
    <div>
      {visible.map((entry, i) => {
        const isRootSnapshot =
          hasPreGit && entry.era === "html" && entry.changeType === "added" && entry.commitHash.startsWith(ROOT_SHA);
        return (
          <Fragment key={i}>
            <EntryRow
              entry={entry}
              labelOverride={isRootSnapshot ? "committed" : undefined}
              isFirst={trimTop && i === 0}
            />
            {!hasReconstructed && entry.pr === PRE_MD_PR && (
              <TimelineRow>
                <SeamFooter seam={entry.seam} />
              </TimelineRow>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
