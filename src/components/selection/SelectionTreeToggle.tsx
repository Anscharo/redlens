import { useState } from "react";
import { useDataSource } from "../../lib/dataSource";
import { useSelection } from "../../lib/selection";
import { track } from "../../lib/analytics";
import { TREE_TOGGLE_BAR_CLASS, TREE_TOGGLE_BAR_STYLE, togglePillStyle } from "../tree/togglePill";
import { usersEnabled } from "../../lib/usersEnabled";
import { SaveCollectionModal } from "./SaveCollectionModal";

// Always-visible bar above the tree (live reader). "All" is always shown; once
// docs are selected a "Selected · n" filter appears with a clear (×) button
// right beside it. On the right, a checkbox toggles selection mode (when on,
// every document shows a checkbox) alongside the save-as-collection button.
// Hidden only in preview, where PreviewTreeToggle owns this slot (mutually
// exclusive).
export function SelectionTreeToggle() {
  const { preview } = useDataSource();
  const { ids, selectionMode, setSelectionMode, selectedOnly, setSelectedOnly, setActiveCollectionId, clear } =
    useSelection();
  const [showSave, setShowSave] = useState(false);
  if (preview) return null;
  const count = ids.size;

  return (
    <div className={TREE_TOGGLE_BAR_CLASS} style={TREE_TOGGLE_BAR_STYLE}>
      <button
        className="px-2 py-0.5 rounded"
        style={togglePillStyle(!selectedOnly, "var(--tan)")}
        onClick={() => {
          track("selection_view_toggle", { view: "all", count });
          setSelectedOnly(false);
        }}
      >
        All
      </button>

      {count > 0 && (
        <>
          <button
            className="px-2 py-0.5 rounded"
            style={togglePillStyle(selectedOnly, "#fff")}
            onClick={() => {
              track("selection_view_toggle", { view: "selected_only", count });
              setSelectedOnly(true);
            }}
          >
            Selected · {count}
          </button>
          <button
            type="button"
            className="px-1 py-0.5 rounded text-tan-3 hover:text-tan"
            title="Clear selection"
            aria-label="Clear selection"
            onClick={() => {
              // Also drop the view mode + active collection: otherwise selectedOnly
              // stays true in the URL, the filter vanishes (no ids), and the next
              // checkbox snaps straight back into a hidden selected-only view.
              clear();
              setSelectedOnly(false);
              setActiveCollectionId(null);
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
              <path d="M1 1 L9 9 M9 1 L1 9" />
            </svg>
          </button>
        </>
      )}

      <div className="flex-1" />

      {/* Saving needs the auth + collections backend, which only exists when
          logins are enabled. In static builds hide the affordance rather than
          offer a sign-in that dead-ends at a disabled /api/auth. */}
      {count > 0 && usersEnabled() && (
        <button
          type="button"
          className="px-1 py-0.5 rounded text-tan-3 hover:text-tan"
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
      )}

      {/* Selection-mode toggle — a checkbox mirroring the per-document ones, so
          its meaning ("show the checkboxes") reads at a glance. */}
      <label
        className="atlas-node-select"
        title={selectionMode ? "Turn off selection mode" : "Turn on selection mode (show checkboxes)"}
        aria-label="Selection mode"
      >
        <input
          type="checkbox"
          checked={selectionMode}
          onChange={() => {
            track("selection_mode_toggle", { on: !selectionMode, count });
            setSelectionMode(!selectionMode);
          }}
        />
      </label>

      {showSave && <SaveCollectionModal ids={[...ids]} onClose={() => setShowSave(false)} />}
    </div>
  );
}
