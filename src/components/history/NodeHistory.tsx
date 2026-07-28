import { Fragment, useEffect, useState } from "react";
import { loadHistory, RECONSTRUCTED_ERAS, type HistoryEntry } from "../../lib/history";
import { track } from "../../lib/analytics";
import { EntryRow } from "./EntryRow";
import { HtmlEraDisclaimer, PreGitDisclaimer, PRE_MD_HTML_URL } from "./HistoryDisclaimers";

// Before PR #117 (commit 22cc27b5, 2025-11-21) the atlas was a single HTML file
// with no per-doc identities. Two cases:
//  · reconstructed — the pre-#117 per-doc history is now threaded into atlas_history
//    (era="html", plus era="mip"/"genesis"/"severed" further back — docs/plans/
//    pre-git-history.md); hidden by default behind the "View Reconstructed History"
//    toggle, with a disclaimer shown before each reconstructed block.
//  · not reconstructed — a doc created AT the migration (no reconstructed-era entries);
//    keep the legacy one-line footer pointing at the last pre-migration HTML file.
const PRE_MD_PR = 117;
// The repo's first commit (2025-05-28) — everything at/after this is real git history;
// everything below it (era mip/genesis/severed) predates git entirely. When older
// origin events exist, this row's "added" label is a lie (it's not the doc's origin,
// just where git-tracked history starts) — relabel it "committed" instead. Commit
// hashes throughout this pipeline are truncated to 7 chars (gitCommitSeq, buildEvents,
// etc.) — 8 would never match and silently disable the relabel.
const ROOT_SHA = "4e931df";

function PreMdFooter() {
  return (
    <p
      className="mono text-[11px] px-2 py-2.5 leading-snug"
      style={{ color: "var(--tan-3)", border: "2px solid var(--border)" }}
    >
      Before 'Migrate To Markdown File' the atlas was maintained as a single HTML file. 79 prior commits exist in the vendor repo —{" "}
      <a
        href={PRE_MD_HTML_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="hover:underline focus-visible:underline"
        style={{ color: "var(--accent)" }}
      >
        view original HTML →
      </a>
    </p>
  );
}

const PRE_GIT_ERAS = new Set(["mip", "genesis", "severed"]);

export function NodeHistory({ nodeId }: { nodeId: string }) {
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

  if (loading) {
    return (
      <p className="mono text-[11px]" style={{ color: "var(--tan-3)" }}>
        loading history…
      </p>
    );
  }

  if (!entries || entries.length === 0) {
    return (
      <p className="mono text-[11px]" style={{ color: "var(--tan-3)" }}>
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
  // The toggle sits right below the migration entry — that's the actual boundary
  // between native markdown history and everything reconstructed. Migration is a
  // markdown-era entry (not RECONSTRUCTED_ERAS), so its index in `visible` is stable
  // across the toggle. Fall back to the top for the (unlikely) doc whose snapshot was
  // byte-identical across the migration commit, so it never got its own PR117 row.
  const migrationIdx = visible.findIndex((e) => e.pr === PRE_MD_PR);
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

  return (
    <div>
      {migrationIdx === -1 && toggleButton}
      {visible.map((entry, i) => {
        const isRootSnapshot =
          hasPreGit && entry.era === "html" && entry.changeType === "added" && entry.commitHash.startsWith(ROOT_SHA);
        return (
          <Fragment key={i}>
            {i === firstHtmlEra && <HtmlEraDisclaimer />}
            {i === firstPreGit && <PreGitDisclaimer />}
            <EntryRow entry={entry} labelOverride={isRootSnapshot ? "committed" : undefined} isFirst={i === 0} />
            {!hasReconstructed && entry.pr === PRE_MD_PR && <PreMdFooter />}
            {i === migrationIdx && toggleButton}
          </Fragment>
        );
      })}
    </div>
  );
}
