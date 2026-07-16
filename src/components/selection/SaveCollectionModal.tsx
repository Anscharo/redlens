import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../chat/auth";
import { SignInButtons } from "../chat/SignInButtons";
import { useSelection } from "../../lib/selection";
import { createCollection, updateCollectionItems, MAX_COLLECTION_NAME_LEN } from "../../lib/collectionsApi";
import { MAX_COLLECTION_DOCS } from "../../lib/collectionsLimits";
import { track } from "../../lib/analytics";

interface SaveCollectionModalProps {
  ids: string[];
  onClose: () => void;
}

const btnBase: CSSProperties = { fontSize: 11, padding: "6px 12px", borderRadius: 4, cursor: "pointer" };
const ghostBtn: CSSProperties = { ...btnBase, background: "transparent", color: "var(--tan-3)", border: "1px solid var(--border)" };
const primaryBtn: CSSProperties = { ...btnBase, background: "var(--accent)", color: "var(--bg)", border: "1px solid var(--accent)", fontWeight: 600 };

// Save the current selection as a collection. Cloned from the ColorPickerModal
// shell (portal + backdrop/Esc to cancel). When a saved collection is already
// open (activeCollectionId), first offer Update-in-place vs. Save-as-new; a
// successful save sets the active collection so its name shows in the pill.
export function SaveCollectionModal({ ids, onClose }: SaveCollectionModalProps) {
  const { user } = useAuth();
  const { activeCollectionId, activeCollectionName, setActiveCollectionId, setActiveCollectionName } = useSelection();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // With a collection open, show the Update/Save-as-new choice first; "save as
  // new" reveals the name input. With nothing open, go straight to the input.
  const [naming, setNaming] = useState(!activeCollectionId);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (naming) inputRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, naming]);

  async function run(fn: () => Promise<void>) {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await fn();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPending(false);
    }
  }

  const over = ids.length > MAX_COLLECTION_DOCS;

  const handleCreate = () => {
    const trimmed = name.trim();
    if (!trimmed || over) return;
    return run(async () => {
      const created = await createCollection(trimmed, ids);
      setActiveCollectionId(created.id);
      setActiveCollectionName(created.name);
      track("collection_save", { count: ids.length });
    });
  };

  const handleUpdate = () => {
    if (!activeCollectionId || over) return;
    return run(async () => {
      await updateCollectionItems(activeCollectionId, ids);
      track("collection_update", { id: activeCollectionId, count: ids.length });
    });
  };

  const count = (
    <p className="mono" style={{ fontSize: 10, color: over ? "var(--red)" : "var(--tan-3)", margin: "2px 0 0" }}>
      {ids.length.toLocaleString()} / {MAX_COLLECTION_DOCS.toLocaleString()} document{ids.length === 1 ? "" : "s"}
      {over ? " — over the limit" : ""}
    </p>
  );
  const errorLine = error && (
    <p className="mono" style={{ fontSize: 11, color: "var(--red)", margin: 0 }}>
      {error}
    </p>
  );

  const modal = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Save as collection"
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "var(--shadow-strong)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: 20, width: 320, maxWidth: "calc(100vw - 32px)", display: "flex", flexDirection: "column", gap: 12 }}
      >
        {!user ? (
          <>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--tan)", margin: 0 }}>
              Sign in to save this selection as a collection
            </h2>
            <SignInButtons variant="menu" source="collections" sansSerif />
          </>
        ) : !naming ? (
          <>
            <div>
              <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--tan)", margin: 0 }}>Save changes</h2>
              {count}
            </div>
            {errorLine}
            <button onClick={handleUpdate} disabled={pending || over} className="mono" style={{ ...primaryBtn, opacity: pending || over ? 0.6 : 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {pending ? "saving…" : `Update “${activeCollectionName ?? "collection"}”`}
            </button>
            <button onClick={() => setNaming(true)} disabled={pending} className="mono" style={ghostBtn}>
              Save as new collection
            </button>
          </>
        ) : (
          <>
            <div>
              <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--tan)", margin: 0 }}>
                {activeCollectionId ? "Save as new collection" : "Save as collection"}
              </h2>
              {count}
            </div>
            <input
              ref={inputRef}
              className="mono"
              type="text"
              placeholder="Collection name"
              maxLength={MAX_COLLECTION_NAME_LEN}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleCreate();
                }
              }}
              style={{ background: "var(--bg)", color: "var(--tan)", border: "1px solid var(--border)", borderRadius: 4, padding: "6px 8px", fontSize: 12, outline: "none" }}
            />
            {errorLine}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={onClose} className="mono" style={ghostBtn}>
                cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={pending || !name.trim() || over}
                className="mono"
                style={{ ...primaryBtn, cursor: pending || !name.trim() || over ? "default" : "pointer", opacity: pending || !name.trim() || over ? 0.6 : 1 }}
              >
                {pending ? "saving…" : "save"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
