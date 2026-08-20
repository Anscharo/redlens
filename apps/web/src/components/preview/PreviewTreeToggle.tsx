import { useDataSource } from "../../lib/dataSource";
import { usePreviewView } from "../../lib/previewView";
import { usePreviewDiff } from "../../lib/previewDiff";
import { track } from "../../lib/analytics";
import { TREE_TOGGLE_BAR_CLASS, TREE_TOGGLE_BAR_STYLE, togglePillStyle } from "../tree/togglePill";

// Sits above the tree in preview mode: "All" ⇄ "Changed only". The toggle is
// shared state, so it filters both this sidebar AND the reader area.
export function PreviewTreeToggle() {
  const { preview } = useDataSource();
  const { onlyChanged, setOnlyChanged } = usePreviewView();
  const diff = usePreviewDiff();
  if (!preview) return null;
  const count = diff.added.size + diff.changed.size;

  return (
    <div className={TREE_TOGGLE_BAR_CLASS} style={TREE_TOGGLE_BAR_STYLE}>
      <button
        className="px-2 py-0.5 rounded"
        style={togglePillStyle(!onlyChanged, "var(--tan)")}
        onClick={() => {
          track("preview_view_toggle", { view: "all", changed_count: count });
          setOnlyChanged(false);
        }}
      >
        All
      </button>
      <button
        className="px-2 py-0.5 rounded"
        style={togglePillStyle(onlyChanged, "#fff")}
        onClick={() => {
          track("preview_view_toggle", { view: "changed_only", changed_count: count });
          setOnlyChanged(true);
        }}
      >
        Changed only{count ? ` · ${count}` : ""}
      </button>
    </div>
  );
}
