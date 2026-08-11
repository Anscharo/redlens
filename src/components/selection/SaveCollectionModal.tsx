import { useEffect, useRef, useState } from "react";
import { useAuth } from "../chat/auth";
import { SignInButtons } from "../chat/SignInButtons";
import { useSelection } from "../../lib/selection";
import { createCollection, updateCollectionItems, MAX_COLLECTION_NAME_LEN } from "../../lib/collectionsApi";
import { MAX_COLLECTION_DOCS } from "../../lib/collectionsLimits";
import { stashResumeSave } from "../../lib/authReturn";
import { track } from "../../lib/analytics";
import { Modal } from "../Modal";
import { ghostBtn, primaryBtn } from "../modalStyles";

interface SaveCollectionModalProps {
  ids: string[];
  onClose: () => void;
}

// Save the current selection as a collection, in the shared Modal shell.
// When a saved collection is already open (activeCollectionId), first offer
// Update-in-place vs. Save-as-new; a successful save sets the active
// collection so its name shows in the pill.
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

  // The shell focuses the first focusable element on mount (which is this
  // input when `naming` starts true); this additionally focuses it when the
  // user later switches into the naming view from the Update/Save-as-new choice.
  useEffect(() => {
    if (naming) inputRef.current?.focus();
  }, [naming]);

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

  return (
    <Modal label="Save as collection" onClose={onClose}>
      {!user ? (
        <>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--tan)", margin: 0 }}>
            Sign in to save this selection as a collection
          </h2>
          <SignInButtons variant="menu" source="collections" sansSerif onBeforeSignIn={stashResumeSave} />
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
    </Modal>
  );
}
