import { usePreviewDiff } from "../../lib/previewDiff";
import { Tooltip } from "../Tooltip";
import { AtlasLink } from "../AtlasLink";
import { atlasHref } from "@/lib/routes";

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
//
// ⚠ IS AN ACCUSATION, so it is spent only where there is evidence. "This UUID
// now holds a different document" is a claim about what happened, and the only
// thing that demonstrates it is finding where the displaced content WENT
// (swap.movedTo, from relocationTarget). Without that the detector has seen a
// retitle plus a rewritten body and inferred the rest — which is exactly how
// next-gen-atlas#346's respelling pass earned three warnings.
//
// So an uncorroborated swap renders as an ordinary Δ, and its tooltip states
// only what is observed: the title and the body were both replaced. That
// sentence is true whichever way the inference would have gone, and it costs
// the reader nothing when it is a rewrite. The detector still records it as an
// identity swap in diff.json — this is a presentation decision about how loudly
// to say it, not a change to what is detected.

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

  // An uncorroborated swap (no movedTo) is described, not accused — see above.
  if (swap && !swap.movedTo) {
    return (
      <Tooltip
        content={
          <span>
            Rewritten in this preview — both the title and the body were replaced: “{swap.oldTitle}”{" "}
            <span className="enlargen">→</span> “{swap.newTitle}”. The previous content was not
            traced to a single new document in this preview, so there is no way to tell a thorough
            rewrite from a different document taking over this UUID.
          </span>
        }
      >
        <span
          className={className}
          aria-label="retitled and rewritten in this preview"
          style={{ color: "var(--tan)", fontWeight: 700, flexShrink: 0, cursor: "help" }}
        >
          Δ
        </span>
      </Tooltip>
    );
  }

  if (swap || former) {
    const content = swap?.movedTo ? (
      <span>
        Identity changed in this preview — UUID <span className="mono">{nodeId}</span> now holds a
        different document: “{swap.oldTitle}” <span className="enlargen">→</span> “{swap.newTitle}”.{" "}
        The previous content moved to{" "}
        <DocLink id={swap.movedTo.id} label={`${swap.movedTo.doc_no} “${swap.movedTo.title}”`} />.
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
      <Tooltip content={content}>
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
      style={{ color: "var(--tan)", fontWeight: 700, flexShrink: 0 }}
    >
      {added ? "+" : "Δ"}
    </span>
  );
}
