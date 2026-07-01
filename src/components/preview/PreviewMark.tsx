import { usePreviewDiff } from "../../lib/previewDiff";
import { Tooltip } from "../Tooltip";
import { AtlasLink } from "../AtlasLink";
import { atlasHref } from "../../lib/routes";

// Preview redline marker, placed between the doc number and the title so it's
// unambiguous which doc it refers to:
//   "+" = new in this preview
//   "Δ" = changed in this preview
//   "⚠" = identity reassigned — a stable UUID that now holds a *different*
//         document, or content that moved in under a UUID it never had before.
// The ⚠ uses the custom Tooltip (not a native title) so its hover card can link
// to the doc on the other side of the swap. It takes precedence over +/Δ (a
// swapped doc is also "changed"; a doc that received relocated content is also
// "added"). Renders nothing outside preview (empty diff). Used in the reader
// (CollapsibleNode) and the minitree (TreeRow).

function DocLink({ id, label }: { id: string; label: string }) {
  return (
    <AtlasLink to={atlasHref(id)} className="hover:underline" style={{ color: "var(--accent)" }}>
      {label}
    </AtlasLink>
  );
}

export function PreviewMark({ nodeId, className }: { nodeId: string; className?: string }) {
  const diff = usePreviewDiff();
  const swap = diff.identitySwap[nodeId];
  const former = diff.formerUuid[nodeId];

  if (swap || former) {
    const content = swap ? (
      <span>
        Identity changed in this preview — UUID <span className="mono">{nodeId}</span> now holds a
        different document: “{swap.oldTitle}” → “{swap.newTitle}”.{" "}
        {swap.movedTo ? (
          <>
            The previous content moved to{" "}
            <DocLink id={swap.movedTo.id} label={`${swap.movedTo.doc_no} “${swap.movedTo.title}”`} />.
          </>
        ) : (
          "The previous content is not present in this preview."
        )}
      </span>
    ) : former ? (
      <span>
        This content previously appeared under a different UUID —{" "}
        <DocLink id={former.previousId} label={`${former.previousDocNo} “${former.previousTitle}”`} /> (
        <span className="mono">{former.previousId}</span>), which now holds a different document in
        this preview.
      </span>
    ) : null;

    return (
      <Tooltip content={content} delay={300}>
        <span
          className={className}
          aria-label="identity reassigned in this preview"
          style={{ color: "var(--warn)", fontWeight: 700, flexShrink: 0, cursor: "help" }}
        >
          ⚠
        </span>
      </Tooltip>
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
