import { useEffect, useState } from "react";
import { useDataSource } from "../../lib/dataSource";
import { usePreviewDiff, usePreviewPatch } from "../../lib/previewDiff";
import { NodeHistory } from "./NodeHistory";
import { DiffView } from "./DiffView";
import { CONTENT_INDENT, LINE1_H, TimelineRow } from "./Timeline";

// History tab in preview mode. The real per-doc history lives in Postgres for
// the *live* atlas, which is meaningless for an unmerged branch — so instead we
// synthesize "this preview adds/changes this doc" from the accurate diff, with a
// link to the source. (Diff-as-history; real per-commit history is P2.)
const CANONICAL = "sky-ecosystem/next-gen-atlas";
// The ⚠ glyph renders small for its weight next to 11px mono — size it up 25%.
const WARN_GLYPH = { fontSize: "1.25em" };

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
  // What actually made the change — a PR or a bare branch. Until meta.json lands
  // we don't know which, so fall back to the neutral "preview".
  const source = meta ? (isPr ? "pull request" : "branch") : "preview";
  // The head commit's date: the real "when" behind this change, so the entry
  // reads like a live one. Absent on bundles built before the field existed.
  const date = meta?.headCommitAt?.slice(0, 10);
  // Line 1 (date / PR) is what the timeline dot centers on; without it the title
  // line below becomes the row's first line and takes over that job.
  const hasLine1 = !!date || isPr;

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
          {/* Line 1, like a live entry's: the head commit's date, then the PR it
              came from. LINE1_H centers the timeline dot on it. */}
          {hasLine1 && (
            <div className="flex items-baseline gap-2 flex-wrap mono text-[13px]" style={{ lineHeight: `${LINE1_H}px` }}>
              {date ? <time dateTime={date}>{date}</time> : null}
              {isPr && (
                <a
                  href={srcUrl ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:underline focus-visible:underline"
                  style={{ color: "var(--accent)" }}
                >
                  PR {meta?.prNumber}
                </a>
              )}
            </div>
          )}
          {isPr && meta?.prTitle && (
            <p className="italic text-[12px] leading-snug mt-1" style={{ color: "var(--tan)" }}>
              {meta.prTitle}
            </p>
          )}
          {/* No PR to point at — this doc is only reachable via the branch, so the
              branch takes the title slot. If there's no line 1 above it, it's the
              row's first line and carries LINE1_H for the dot instead. */}
          {!isPr && meta?.ref && (
            <p
              className={`italic text-[12px] ${hasLine1 ? "leading-snug mt-1" : ""}`}
              style={{ color: "var(--tan)", ...(hasLine1 ? null : { lineHeight: `${LINE1_H}px` }) }}
            >
              Branch: {meta.repo.split("/")[0]}/{meta.ref}
            </p>
          )}
          {swap && (
            <p className="my-2 leading-snug" style={{ color: "var(--warn)" }}>
              <span style={WARN_GLYPH}>⚠</span> Identity changed — this UUID now holds a different document: “{swap.oldTitle}” → “{swap.newTitle}”.{" "}
              {swap.movedTo
                ? `The previous content moved to ${swap.movedTo.doc_no} (“${swap.movedTo.title}”) under a new UUID.`
                : `The previous content is not present in this ${source}.`}
            </p>
          )}
          {former && (
            <p className="my-2 leading-snug" style={{ color: "var(--warn)" }}>
              <span style={WARN_GLYPH}>⚠</span> This content previously appeared under a different UUID — {former.previousId} (“{former.previousTitle}” at {former.previousDocNo}).
            </p>
          )}
          {renumber && (
            <p className="mt-1" style={{ color: "var(--accent)" }}>
              renumbered {renumber[0]} → {renumber[1]}
            </p>
          )}
          {srcUrl && (
            <a href={srcUrl} target="_blank" rel="noreferrer" className="hover:underline" style={{ color: "var(--accent)" }}>
              view on GitHub
            </a>
          )}
          {patch && patch.length > 0 && <DiffView lines={patch} />}
          </TimelineRow>
        </>
      ) : (
        <p style={{ marginLeft: CONTENT_INDENT }}>Unchanged by this {source}.</p>
      )}
      {/* Below the preview pseudo-entry, the doc's real main-branch history.
          UUIDs are stable across the PR, so /api/history/<uuid> resolves the
          live history for changed docs; added docs (new UUID) show empty. */}
      <hr className="mt-4 mb-3" style={{ border: 0, borderTop: "1px solid var(--border)", marginLeft: CONTENT_INDENT }} />
      {/* Heading + note ride the timeline as a dotless row: with a preview entry
          above, the live rail then runs up to just under the divider instead of
          starting at the first entry. */}
      <TimelineRow hideTop={!status}>
        <h4 className="mb-2 text-sm" style={{ color: "var(--tan-3)" }}>
          On the Live Atlas
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
