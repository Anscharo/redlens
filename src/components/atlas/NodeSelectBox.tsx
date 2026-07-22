import { memo } from "react";
import { useSelection } from "../../lib/selection";
import { useAtlasActions } from "./AtlasActionsContext";

// The per-row selection checkbox, split out of CollapsibleNode so that a
// selection change re-renders only these trivial <input>s — not every full
// reader row. CollapsibleNode is memo'd but can't skip a re-render while it
// subscribes to the selection context directly; isolating the subscription here
// keeps the heavy row body (chiclets, agent pill, markdown, cradle) static.
export const NodeSelectBox = memo(function NodeSelectBox({
  nodeId,
  title,
}: {
  nodeId: string;
  title: string;
}) {
  const { ids, toggleDoc } = useSelection();
  const { selectSubtree } = useAtlasActions();
  return (
    <label
      className="atlas-node-select absolute top-2 right-2"
      aria-label={`Select ${title}`}
      title="shift-click: also select everything beneath"
      onClick={(e) => e.stopPropagation()}
    >
      <input
        type="checkbox"
        checked={ids.has(nodeId)}
        onChange={(e) => {
          e.stopPropagation();
          // Shift-click selects this doc + all its descendants; a plain click
          // toggles just this one. The change event's native mouse event
          // carries the shift state.
          if ((e.nativeEvent as MouseEvent).shiftKey && selectSubtree) {
            selectSubtree(nodeId);
          } else {
            toggleDoc(nodeId);
          }
        }}
      />
    </label>
  );
});
