import { memo } from "react";
import { useSelection } from "../lib/selection";

// Selection checkbox for a search-result card. Mirrors the reader's
// NodeSelectBox: it self-subscribes to the selection so a toggle re-renders only
// this <input> — not the whole SearchResults list (SearchResult stays memo'd and
// static). Reveals on result hover via the shared .atlas-node-select styling (see
// index.css). No shift-click subtree here: search results are a flat list with no
// tree context, so a click just toggles the one doc into the current selection.
export const SearchResultSelectBox = memo(function SearchResultSelectBox({
  nodeId,
  title,
}: {
  nodeId: string;
  title: string;
}) {
  const { ids, toggleDoc } = useSelection();
  return (
    <label
      className="atlas-node-select absolute top-2 right-2"
      aria-label={`Select ${title}`}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        type="checkbox"
        checked={ids.has(nodeId)}
        onChange={(e) => {
          e.stopPropagation();
          toggleDoc(nodeId);
        }}
      />
    </label>
  );
});
