import { useState } from "react";
import { useDataSource } from "../../lib/dataSource";
import { useSelection } from "../../lib/selection";
import { track } from "../../lib/analytics";
import { SaveCollectionModal } from "./SaveCollectionModal";

// Always-visible bar above the tree (live reader). A "Select" toggle turns
// selection mode on/off — when on, every document shows a checkbox. Once docs
// are selected, an "All ⇄ Selected · n" filter plus clear / save-as-collection
// controls appear. Hidden only in preview, where PreviewTreeToggle owns this
// slot (the two are mutually exclusive).
export function SelectionTreeToggle() {
  const { preview } = useDataSource();
  const { ids, selectionMode, setSelectionMode, selectedOnly, setSelectedOnly, setActiveCollectionId, clear } =
    useSelection();
  const [showSave, setShowSave] = useState(false);
  if (preview) return null;
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
        style={btn(selectionMode, "var(--accent)")}
        title={selectionMode ? "Turn off selection mode" : "Turn on selection mode (show checkboxes)"}
        aria-pressed={selectionMode}
        onClick={() => {
          track("selection_mode_toggle", { on: !selectionMode, count });
          setSelectionMode(!selectionMode);
        }}
      >
        Select
      </button>

      {count > 0 && (
        <>
          <span aria-hidden="true" style={{ color: "var(--border)" }}>
            |
          </span>
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
          {/* Saving needs the auth + collections backend, which only exists when
              chat is enabled. In static builds hide the affordance rather than
              offer a sign-in that dead-ends at a disabled /api/auth. */}
          {__CHAT_ENABLED__ && (
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
          )}
        </>
      )}
      {showSave && <SaveCollectionModal ids={[...ids]} onClose={() => setShowSave(false)} />}
    </div>
  );
}
