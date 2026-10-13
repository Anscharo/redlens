import { useDataSource } from "../../lib/dataSource";
import { usePreviewDiff, usePreviewPatch } from "../../lib/previewDiff";
import { usePreviewMeta } from "../../lib/previewMeta";
import { entrySourceUrl, type PreviewMeta } from "../../lib/previewMetaCopy";
import { NodeHistory } from "./NodeHistory";
import { DiffTitle } from "./DiffTitle";
import { DiffView } from "./DiffView";
import { PreviewChangeNotes } from "./PreviewChangeNotes";
import { PreviewCommits } from "./PreviewCommits";
import { PreviewEntryLine1 } from "./PreviewEntryLine1";
import { CONTENT_INDENT, TimelineRow } from "./Timeline";

// History tab in preview mode. The real per-doc history lives in Postgres for
// the *live* atlas, which is meaningless for an unmerged branch — so instead we
// synthesize "this preview adds/changes this doc" from the accurate diff, with a
// link to the source, and under it the branch's commits that touched the doc
// (PreviewCommits, behind `?history=by-commit`).
export function PreviewHistory({ nodeId }: { nodeId: string }) {
  const { base } = useDataSource();
  const diff = usePreviewDiff();
  const patch = usePreviewPatch(nodeId);
  const meta: PreviewMeta | null = usePreviewMeta(base) ?? null;
  const status = diff.added.has(nodeId) ? "Added" : diff.changed.has(nodeId) ? "Changed" : null;
  // Added doc whose doc number exists on the live atlas under another uuid
  // (slot reuse, flagged server-side with the old occupant's title + where it
  // moved). The label gets an asterisk; the disclaimer below the live-history
  // heading explains it.
  const reused = status === "Added" ? diff.reusedSlot[nodeId] : undefined;
  // What actually made the change — a PR (anything with a PR number, the same
  // rule as PreviewBanner) or a bare branch. Until meta.json lands we don't
  // know which, so fall back to the neutral "preview".
  const source = meta ? (meta.prNumber ? "pull request" : "branch") : "preview";

  return (
    <div className="mono text-[11px]" style={{ color: "var(--tan-3)" }}>
      {status ? (
        <>
          {/* Section heading — same treatment as "On the Live Atlas" below, and
              outside the timeline, so the node dot lands on the PR line instead. */}
          <h4 className="mb-2 text-sm" style={{ color: "var(--tan-3)", marginLeft: CONTENT_INDENT }}>
            {status}
            {reused ? <sup>*</sup> : null} in this {source}
          </h4>
          {/* A timeline node like the live entries, but its downward line dissolves
              into a fuzzy break — this change isn't cemented into history yet. */}
          <TimelineRow dot="var(--preview-add)" fuzz hideTop>
          <PreviewEntryLine1 meta={meta} />
          <DiffTitle meta={meta} />
          <PreviewChangeNotes nodeId={nodeId} meta={meta} source={source} hasPatch={!!patch && patch.length > 0} status={status} />
          {meta && (
            <a href={entrySourceUrl(meta)} target="_blank" rel="noreferrer" className="hover:underline" style={{ color: "var(--accent)" }}>
              view on GitHub
            </a>
          )}
          {patch && patch.length > 0 && <DiffView lines={patch} />}
          </TimelineRow>
        </>
      ) : (
        <p style={{ marginLeft: CONTENT_INDENT }}>Unchanged by this {source}.</p>
      )}
      <PreviewCommits nodeId={nodeId} changed={!!status} />
      {/* Below the preview pseudo-entry, the doc's real main-branch history.
          UUIDs are stable across the PR, so /api/history/<uuid> resolves the
          live history for changed docs; added docs (new UUID) show empty. */}
      <hr className="mt-4 mb-3" style={{ border: 0, borderTop: "1px solid var(--border)", marginLeft: CONTENT_INDENT }} />
      {/* Heading + note ride the timeline as a dotless row: with a preview entry
          above, the live rail then runs up to just under the divider instead of
          starting at the first entry. */}
      <TimelineRow hideTop={!status}>
        {/* Always the live atlas: the section below is Postgres history of
            live main, whatever base the redline above was computed against. */}
        <h4 className="mb-2 text-sm" style={{ color: "var(--tan-3)" }}>
          On the live atlas
        </h4>
        {reused && (
          <p className="mb-2 leading-snug" style={{ color: "var(--tan-3)" }}>
            <sup>*</sup> This doc is new but takes over an existing doc number
            {reused.title ? <> — previously “{reused.title}”, which {reused.movedTo ? `moved to ${reused.movedTo} in this ${source}` : `is not present in this ${source}`}</> : null}
            . As a new doc it has no prior history.
          </p>
        )}
      </TimelineRow>
      <NodeHistory nodeId={nodeId} railAbove={!!status} />
    </div>
  );
}
