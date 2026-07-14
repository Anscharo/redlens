import { useState } from "react";
import { useDataSource } from "../../lib/dataSource";
import { useSelection } from "../../lib/selection";
import { track } from "../../lib/analytics";
import { SaveCollectionModal } from "./SaveCollectionModal";

// Sits above the tree, mirroring PreviewTreeToggle: "All" ⇄ "Selected · n",
// plus a save-as-collection affordance. Self-gating — hidden in preview mode
// or when nothing is selected — so it and PreviewTreeToggle never both show.
export function SelectionTreeToggle() {
  const { preview } = useDataSource();
  const { ids, selectedOnly, setSelectedOnly, clear } = useSelection();
  const [showSave, setShowSave] = useState(false);
  if (preview || ids.size === 0) return null;
  const count = ids.size;

  const btn = (active: boolean, color: string): React.CSSProperties => ({
    color: active ? color : "var(--tan-3)",
    background: active ? "var(--hover)" : "transparent",
    fontWeight: active ? 600 : 400,
  });

  return (
    <div
      className="flex items-center gap-1 px-2 py-1.5 text-[11px] mono shrink-0"
      style={{ borderBottom: "1px solid var(--border)" }}
    >
      <button
        className="px-2 py-0.5 rounded"
        style={btn(!selectedOnly, "var(--tan)")}
        onClick={() => {
          track("selection_view_toggle", { view: "all", count });
          setSelectedOnly(false);
        }}
      >
        All
      </button>
      <button
        className="px-2 py-0.5 rounded"
        style={btn(selectedOnly, "#fff")}
        onClick={() => {
          track("selection_view_toggle", { view: "selected_only", count });
          setSelectedOnly(true);
        }}
      >
        Selected · {count}
      </button>
      <div className="flex-1" />
      <button
        type="button"
        className="px-1.5 py-0.5 rounded text-tan-3 hover:text-tan"
        title="Clear selection"
        aria-label="Clear selection"
        onClick={() => clear()}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
          <path d="M1 1 L9 9 M9 1 L1 9" />
        </svg>
      </button>
      <button
        type="button"
        className="px-1.5 py-0.5 rounded text-tan-3 hover:text-tan"
        title="Save as collection"
        aria-label="Save as collection"
        onClick={() => {
          track("collection_save_open", { count });
          setShowSave(true);
        }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
          <path d="M1.5 1.5 h7 l2 2 v7 h-9 z" />
          <path d="M3.5 1.5 v3 h4 v-3" />
          <path d="M3 8 h6" />
        </svg>
      </button>
      {showSave && <SaveCollectionModal ids={[...ids]} onClose={() => setShowSave(false)} />}
    </div>
  );
}
