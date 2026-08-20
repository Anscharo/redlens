import { Fragment, useEffect, useState } from "react";
import { loadHistory, PRE_MD_PR, RECONSTRUCTED_ERAS, type HistoryEntry } from "@/lib/history";
import { track } from "@/lib/analytics";
import { EntryRow } from "./EntryRow";
import { HtmlEraDisclaimer, PreGitDisclaimer } from "./HistoryDisclaimers";
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
  const [showReconstructed, setShowReconstructed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setEntries(null);
    setShowReconstructed(false);
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
  // Reconstructed entries (every era in RECONSTRUCTED_ERAS) are hidden until the toggle
  // is on. When shown, each block's disclaimer appears once, right before its first entry.
  const visible = showReconstructed ? sorted : sorted.filter((e) => !e.era || !RECONSTRUCTED_ERAS.has(e.era));
  const firstHtmlEra = visible.findIndex((e) => e.era === "html");
  const firstPreGit = visible.findIndex((e) => e.era && PRE_GIT_ERAS.has(e.era));
  const toggleButton = hasReconstructed && (
    <button
      type="button"
      aria-pressed={showReconstructed}
      onClick={() => {
        track("reader_history_reconstructed_toggle", { node_id: nodeId, action: showReconstructed ? "hide" : "show" });
        setShowReconstructed((v) => !v);
      }}
      className="mono text-[11px] uppercase tracking-wide px-2 py-1 my-2 rounded"
      style={{
        color: showReconstructed ? "var(--bg)" : "var(--accent)",
        background: showReconstructed ? "var(--accent)" : "transparent",
        border: "1px solid var(--accent)",
      }}
    >
      {showReconstructed ? "Hide Reconstructed History" : "View Reconstructed History"}
    </button>
  );

  // The reconstructed-history toggle sits at the native↔reconstructed boundary —
  // just above the block it shows/hides. When those entries are visible it renders
  // right before the first one; when hidden (none are in `visible`) it renders at
  // the very bottom, directly below the last native entry, where the block appears.
  // Disclaimers/footer/toggle sit *inside* the timeline (indented into the entry
  // column, rail running past them) so the line never breaks; only the topmost block
  // of the list trims the rail above it (and not when the rail runs in from above).
  const firstReconstructedIdx = visible.findIndex((e) => e.era && RECONSTRUCTED_ERAS.has(e.era));
  const topIsBlock = firstReconstructedIdx === 0;
  const trimTop = !railAbove;

  return (
    <div>
      {visible.map((entry, i) => {
        const isRootSnapshot =
          hasPreGit && entry.era === "html" && entry.changeType === "added" && entry.commitHash.startsWith(ROOT_SHA);
        const disclaimer =
          i === firstHtmlEra ? <HtmlEraDisclaimer /> : i === firstPreGit ? <PreGitDisclaimer /> : null;
        const toggleHere = i === firstReconstructedIdx && !!toggleButton;
        return (
          <Fragment key={i}>
            {toggleHere && <TimelineRow hideTop={trimTop && i === 0}>{toggleButton}</TimelineRow>}
            {disclaimer && (
              <TimelineRow hideTop={trimTop && i === 0 && !toggleHere}>{disclaimer}</TimelineRow>
            )}
            <EntryRow
              entry={entry}
              labelOverride={isRootSnapshot ? "committed" : undefined}
              isFirst={trimTop && i === 0 && !topIsBlock}
            />
            {!hasReconstructed && entry.pr === PRE_MD_PR && (
              <TimelineRow>
                <SeamFooter seam={entry.seam} />
              </TimelineRow>
            )}
          </Fragment>
        );
      })}
      {/* No reconstructed entries visible (toggle off) → the button sits at the
          bottom, right where the hidden block would appear. */}
      {firstReconstructedIdx === -1 && toggleButton && <TimelineRow>{toggleButton}</TimelineRow>}
    </div>
  );
}
