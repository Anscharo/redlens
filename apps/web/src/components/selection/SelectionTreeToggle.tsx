import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useDataSource } from "../../lib/dataSource";
import { useAuth } from "../chat/auth";
import { takeResumeSave } from "../../lib/authReturn";
import { useSelection } from "../../lib/selection";
import { track } from "../../lib/analytics";
import { ROUTES } from "@/lib/routes";
import { TREE_TOGGLE_BAR_CLASS, TREE_TOGGLE_BAR_STYLE, togglePillStyle } from "../tree/togglePill";
import { usersEnabled } from "../../lib/usersEnabled";
import { SaveCollectionModal } from "./SaveCollectionModal";

// Bar above the tree (live reader). "All" plus, once docs are selected, a
// "Selected · n" filter with a clear (×), a save-as-collection button, and a
// checkbox that toggles selection mode. The select checkbox is a READER entry
// point, so it only shows on the /atlas route — not the home/search pages, where
// the tree is also mounted. With nothing selected off the reader, the whole bar
// is hidden. Always hidden in preview (PreviewTreeToggle owns this slot).
export function SelectionTreeToggle() {
  const { preview } = useDataSource();
  const [location, navigate] = useLocation();
  const {
    ids,
    selectedOnly,
    setSelectedOnly,
    setActiveCollectionId,
    activeCollectionName,
    setActiveCollectionName,
    clear,
  } = useSelection();
  const [showSave, setShowSave] = useState(false);
  const { user } = useAuth();

  // Reopen the save modal after an OAuth round-trip that began here: openAuth
  // restored the URL (back to /atlas), and this flag — set only when sign-in was
  // launched from the modal — flips it back open once we're actually logged in.
  // `user &&` short-circuits so the one-shot flag isn't consumed while auth is
  // still resolving (user null on first render, then populates).
  useEffect(() => {
    if (user && takeResumeSave()) setShowSave(true);
  }, [user]);

  if (preview) return null;
  const count = ids.size;
  const inReader = location === ROUTES.ATLAS;
  // Off the reader (home / search-hints), the selection UI only earns its space
  // when there's already a selection to filter — otherwise hide the bar entirely.
  if (!inReader && count === 0) return null;

  return (
    <div className={TREE_TOGGLE_BAR_CLASS} style={TREE_TOGGLE_BAR_STYLE}>
      <button
        className="px-2 py-0.5 rounded shrink-0"
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
            className="px-2 py-0.5 rounded flex items-center gap-1 min-w-0"
            style={togglePillStyle(selectedOnly, "var(--tan)")}
            title={activeCollectionName ?? undefined}
            onClick={() => {
              track("selection_view_toggle", { view: "selected_only", count });
              setSelectedOnly(true);
            }}
          >
            {/* Name yields first (truncates) when the row is cramped; on a wide
                sidebar it shows in full — no fixed cap, just flex shrink. */}
            <span className="truncate min-w-0">{activeCollectionName ?? "Selected"}</span>
            <span className="shrink-0">· {count}</span>
          </button>
          <button
            type="button"
            className="px-1 py-0.5 rounded text-tan-3 hover:text-tan shrink-0"
            title="Clear selection"
            aria-label="Clear selection"
            onClick={() => {
              // Also drop the view mode + active collection: otherwise selectedOnly
              // stays true in the URL, the filter vanishes (no ids), and the next
              // checkbox snaps straight back into a hidden selected-only view.
              clear();
              setSelectedOnly(false);
              setActiveCollectionId(null);
              setActiveCollectionName(null);
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
          className="px-1 py-0.5 rounded text-tan-3 hover:text-tan shrink-0"
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

      {/* Jump to the full Collections page (a users feature, same gate as save). */}
      {usersEnabled() && (
        <button
          type="button"
          className="px-1 py-0.5 rounded text-tan-3 hover:text-tan shrink-0"
          title="Open collections"
          aria-label="Open collections"
          onClick={() => {
            track("collections_open_nav", {});
            navigate(ROUTES.COLLECTIONS);
          }}
        >
          <svg width="13" height="12" viewBox="0 0 13 12" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
            <path d="M1 2.5 h3.5 l1 1.5 h6 v6.5 h-10.5 z" />
          </svg>
        </button>
      )}

      {showSave && <SaveCollectionModal ids={[...ids]} onClose={() => setShowSave(false)} />}
    </div>
  );
}
