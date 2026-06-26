import { usePreviewDiff } from "../../lib/previewDiff";

// Preview redline marker, placed between the doc number and the title so it's
// unambiguous which doc it refers to:
//   "+" = new in this preview
//   "Δ" = changed in this preview
//   "⚠" = identity reassigned — a stable UUID that now holds a *different*
//         document, or content that moved in under a UUID it never had before.
// The ⚠ takes precedence over +/Δ (a swapped doc is also "changed"; a doc that
// received relocated content is also "added"). Renders nothing outside preview
// (empty diff). Used in the reader (CollapsibleNode) and the minitree (TreeRow).
export function PreviewMark({ nodeId, className }: { nodeId: string; className?: string }) {
  const diff = usePreviewDiff();
  const swap = diff.identitySwap[nodeId];
  const former = diff.formerUuid[nodeId];
  if (swap || former) {
    const title = swap
      ? `Identity changed in this preview — UUID ${nodeId} now holds a different document: “${swap.oldTitle}” → “${swap.newTitle}”.` +
        (swap.movedTo ? ` The previous content moved to ${swap.movedTo.doc_no} (“${swap.movedTo.title}”).` : " The previous content is not present in this preview.")
      : `This content previously appeared under a different UUID (${former!.previousId} — “${former!.previousTitle}” at ${former!.previousDocNo}); it is shown here as a new document.`;
    return (
      <span
        className={className}
        title={title}
        aria-label="identity reassigned in this preview"
        style={{ color: "var(--warn)", fontWeight: 700, flexShrink: 0 }}
      >
        ⚠
      </span>
    );
  }
  const added = diff.added.has(nodeId);
  const changed = !added && diff.changed.has(nodeId);
  if (!added && !changed) return null;
  return (
    <span
      className={className}
      title={added ? "New in this preview" : "Changed in this preview"}
      aria-label={added ? "new in this preview" : "changed in this preview"}
      style={{ color: "#fff", fontWeight: 700, flexShrink: 0 }}
    >
      {added ? "+" : "Δ"}
    </span>
  );
}
