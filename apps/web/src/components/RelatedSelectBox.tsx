import { memo } from "react";
import type { AtlasNode } from "@/types";
import { useSelection } from "../lib/selection";
import { collectSubtree } from "@/lib/atlasHelpers";
import { HOVER_HINTS, plainHint } from "../lib/hintText";

// Selection checkbox for an annotations-panel related card. Mirrors the reader's
// NodeSelectBox: it self-subscribes to the selection so a toggle re-renders only
// this <input> — not RightPanel/AtlasAnnotations/AtlasView (and, crucially, not
// the sibling reader). byParent is a stable ref from data.atlas, used to expand
// the subtree on shift-click.
export const RelatedSelectBox = memo(function RelatedSelectBox({
  node,
  byParent,
}: {
  node: AtlasNode;
  byParent: Map<string | null, AtlasNode[]>;
}) {
  const { ids, toggleDoc, selectSubtree } = useSelection();
  return (
    <label
      className="atlas-node-select absolute top-2 right-2"
      aria-label={`Select ${node.title}`}
      // Same sentence the footer hint shows, from the same source — see NodeSelectBox.
      title={plainHint(HOVER_HINTS.subtree)}
      data-mod-hint="subtree"
      onClick={(e) => e.stopPropagation()}
    >
      <input
        type="checkbox"
        checked={ids.has(node.id)}
        onChange={(e) => {
          e.stopPropagation();
          if ((e.nativeEvent as MouseEvent).shiftKey) {
            selectSubtree(collectSubtree(byParent, node.id));
          } else {
            toggleDoc(node.id);
          }
        }}
      />
    </label>
  );
});
