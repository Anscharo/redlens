import { useEffect, useState } from "react";
import { loadHistory, type HistoryEntry } from "@/lib/history";
import { HistoryList } from "./HistoryList";
import { CONTENT_INDENT } from "./Timeline";

// Before PR #117 (commit 22cc27b5, 2025-11-21) the atlas was a single HTML file
// with no per-doc identities. Two cases:
//  · reconstructed — the pre-#117 per-doc history is now threaded into atlas_history
//    (era="html", plus era="mip"/"genesis"/"severed" further back — docs/plans/
//    pre-git-history.md); shown inline like every other entry, each flagging its
//    provenance with an info-icon tooltip by its date (EntryRow).
//  · not reconstructed — no pre-#117 entries were threaded to this doc. SeamFooter says
//    which of the two that is: a reviewed "created at the migration" verdict, or (the
//    common case) that the doc's earlier history could not be traced at all.
// The repo's first commit (2025-05-28) — everything at/after this is real git history;
// everything below it (era mip/genesis/severed) predates git entirely. When older
// origin events exist, this row's "added" label is a lie (it's not the doc's origin,
// just where git-tracked history starts) — relabel it "committed" instead. Commit
// hashes throughout this pipeline are truncated to 7 chars (gitCommitSeq, buildEvents,
// etc.) — 8 would never match and silently disable the relabel.
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

  useEffect(() => loadNodeHistory(nodeId, setEntries, setLoading), [nodeId]);

  if (loading) return <HistoryStatus>loading history…</HistoryStatus>;
  if (!entries || entries.length === 0) return <HistoryStatus>no history recorded</HistoryStatus>;
  return <HistoryList entries={entries} railAbove={railAbove} />;
}

function loadNodeHistory(
  nodeId: string,
  setEntries: (entries: HistoryEntry[] | null) => void,
  setLoading: (loading: boolean) => void,
) {
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
}

function HistoryStatus({ children }: { children: string }) {
  return (
    <p className="mono text-[11px]" style={{ color: "var(--tan-3)", marginLeft: CONTENT_INDENT }}>
      {children}
    </p>
  );
}

