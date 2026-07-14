import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../chat/auth";
import { SignInButtons } from "../chat/SignInButtons";
import { createCollection, MAX_COLLECTION_NAME_LEN } from "../../lib/collectionsApi";
import { track } from "../../lib/analytics";

interface SaveCollectionModalProps {
  ids: string[];
  onClose: () => void;
}

// Clones the ColorPickerModal shell: createPortal to body, backdrop-click and
// Esc both cancel, autofocus + Enter-to-confirm on the primary input.
export function SaveCollectionModal({ ids, onClose }: SaveCollectionModalProps) {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed || pending) return;
    setPending(true);
    setError(null);
    try {
      await createCollection(trimmed, ids);
      track("collection_save", { count: ids.length });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPending(false);
    }
  }

  const modal = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Save as collection"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--shadow-strong)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: 20,
          width: 320,
          maxWidth: "calc(100vw - 32px)",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {!user ? (
          <>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--tan)", margin: 0 }}>
              Sign in to save this selection as a collection
            </h2>
            <SignInButtons variant="menu" source="collections" sansSerif />
          </>
        ) : (
          <>
            <div>
              <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--tan)", margin: 0 }}>
                Save as collection
              </h2>
              <p className="mono" style={{ fontSize: 10, color: "var(--tan-3)", margin: "2px 0 0" }}>
                {ids.length} document{ids.length === 1 ? "" : "s"}
              </p>
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
                  handleSave();
                }
              }}
              style={{
                background: "var(--bg)",
                color: "var(--tan)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                padding: "6px 8px",
                fontSize: 12,
                outline: "none",
              }}
            />
            {error && (
              <p className="mono" style={{ fontSize: 11, color: "var(--red)", margin: 0 }}>
                {error}
              </p>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                onClick={onClose}
                className="mono"
                style={{
                  fontSize: 11,
                  padding: "6px 12px",
                  background: "transparent",
                  color: "var(--tan-3)",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                cancel
              </button>
              <button
                onClick={handleSave}
                disabled={pending || !name.trim()}
                className="mono"
                style={{
                  fontSize: 11,
                  padding: "6px 12px",
                  background: "var(--accent)",
                  color: "var(--bg)",
                  border: "1px solid var(--accent)",
                  borderRadius: 4,
                  cursor: pending || !name.trim() ? "default" : "pointer",
                  opacity: pending || !name.trim() ? 0.6 : 1,
                  fontWeight: 600,
                }}
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
