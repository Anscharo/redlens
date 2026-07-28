import { useEffect, useState } from "react";
import { useDataSource } from "../../lib/dataSource";
import { usePreviewDiff, usePreviewPatch } from "../../lib/previewDiff";
import { NodeHistory } from "./NodeHistory";
import { DiffView } from "./DiffView";
import { TimelineRail } from "./Timeline";

// History tab in preview mode. The real per-doc history lives in Postgres for
// the *live* atlas, which is meaningless for an unmerged branch — so instead we
// synthesize "this preview adds/changes this doc" from the accurate diff, with a
// link to the source. (Diff-as-history; real per-commit history is P2.)
const CANONICAL = "sky-ecosystem/next-gen-atlas";

interface Meta {
  ref: string;
  kind: string;
  repo: string;
  sha: string;
  prNumber?: number;
  prTitle?: string;
  prAuthor?: string;
}

export function PreviewHistory({ nodeId }: { nodeId: string }) {
  const { base } = useDataSource();
  const diff = usePreviewDiff();
  const patch = usePreviewPatch(nodeId);
  const [meta, setMeta] = useState<Meta | null>(null);
  useEffect(() => {
    fetch(`${base}meta.json`).then((r) => r.json()).then(setMeta).catch(() => {});
  }, [base]);

  const status = diff.added.has(nodeId) ? "Added" : diff.changed.has(nodeId) ? "Changed" : null;
  // A changed doc that moved: same UUID, new doc number ([live, preview]).
  const renumber = diff.renumbered[nodeId];
  // Added doc whose doc number exists on the live atlas under another uuid
  // (slot reuse, flagged server-side with the old occupant's title + where it
  // moved). The label gets an asterisk; the disclaimer below the live-history
  // heading explains it.
  const reused = status === "Added" ? diff.reusedSlot[nodeId] : undefined;
  // UUID-identity reassignment — surfaced prominently: this UUID's document was
  // replaced (swap), or this doc holds content that used to live under another
  // UUID (former).
  const swap = diff.identitySwap[nodeId];
  const former = diff.formerUuid[nodeId];
  const srcUrl = meta
    ? meta.kind === "pr" && meta.prNumber
      ? `https://github.com/${CANONICAL}/pull/${meta.prNumber}`
      : `https://github.com/${meta.repo}/commit/${meta.sha}`
    : null;
  const isPr = meta?.kind === "pr" && !!meta.prNumber;
  const label = meta?.prTitle ? `${meta.ref} — ${meta.prTitle}` : meta?.ref ?? "this preview";

  return (
    <div className="mono text-[11px]" style={{ color: "var(--tan-3)" }}>
      {status ? (
        // A timeline node like the live entries, but its downward line dissolves
        // into a fuzzy break — this change isn't cemented into history yet.
        <div className="flex gap-3 pb-3">
          <TimelineRail color="var(--preview-add)" fuzz hideTop />
          <div className="min-w-0 flex-1">
          <div style={{ color: "var(--preview-add)", fontWeight: 600 }}>
            {status}
            {reused ? "*" : ""} in this preview
            {/* No PR to point at — this doc is only reachable via the preview's
                branch, so weave the branch name into the "added/changed" line. */}
            {!isPr && meta?.ref ? ` from branch: “${meta.ref}”` : ""}
          </div>
          {(isPr || meta?.prAuthor) && (
            <div className="mt-1">
              {isPr ? label : ""}
              {meta?.prAuthor ? `${isPr ? " · " : ""}by ${meta.prAuthor}` : ""}
            </div>
          )}
          {swap && (
            <div className="mt-2 leading-snug" style={{ color: "var(--warn)" }}>
              ⚠ Identity changed — this UUID now holds a different document: “{swap.oldTitle}” → “{swap.newTitle}”.{" "}
              {swap.movedTo
                ? `The previous content moved to ${swap.movedTo.doc_no} (“${swap.movedTo.title}”) under a new UUID.`
                : "The previous content is not present in this preview."}
            </div>
          )}
          {former && (
            <div className="mt-2 leading-snug" style={{ color: "var(--warn)" }}>
              ⚠ This content previously appeared under a different UUID — {former.previousId} (“{former.previousTitle}” at {former.previousDocNo}).
            </div>
          )}
          {renumber && (
            <div className="mt-1" style={{ color: "var(--accent)" }}>
              renumbered {renumber[0]} → {renumber[1]}
            </div>
          )}
          {srcUrl && (
            <a href={srcUrl} target="_blank" rel="noreferrer" className="hover:underline" style={{ color: "var(--accent)" }}>
              view on GitHub →
            </a>
          )}
          {patch && patch.length > 0 && <DiffView lines={patch} />}
          </div>
        </div>
      ) : (
        <p>Unchanged by this preview.</p>
      )}
      {/* Below the preview pseudo-entry, the doc's real main-branch history.
          UUIDs are stable across the PR, so /api/history/<uuid> resolves the
          live history for changed docs; added docs (new UUID) show empty. */}
      <div className="mt-4 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
        <div className="mb-2" style={{ color: "var(--tan-3)" }}>On the live atlas</div>
        {reused && (
          <p className="mb-2 leading-snug" style={{ color: "var(--tan-3)" }}>
            * This doc is new but takes over an existing doc number
            {reused.title ? <> — previously “{reused.title}”, which {reused.movedTo ? `moved to ${reused.movedTo} in this preview` : "is not present in this preview"}</> : null}
            . As a new doc it has no prior history.
          </p>
        )}
        <NodeHistory nodeId={nodeId} />
      </div>
    </div>
  );
}
