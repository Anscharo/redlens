import { useEffect, useRef } from "react";
import { MAX_COLLECTION_NAME_LEN } from "../../lib/collectionsApi";
import { ghostBtn, primaryBtn } from "../modalStyles";

interface SaveNameViewProps {
  name: string;
  onName: (name: string) => void;
  onSave: () => void;
  onCancel: () => void;
  pending: boolean;
  /** Saving is not possible: no name yet, or over the size limit. */
  blocked: boolean;
}

// The naming step shared by every save-as-new path. Focuses the input on mount
// (the Modal shell only does so for the first view it opens on).
export function SaveNameView({ name, onName, onSave, onCancel, pending, blocked }: SaveNameViewProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  const off = pending || blocked;
  return (
    <>
      <input
        ref={inputRef}
        className="mono"
        type="text"
        placeholder="Collection name"
        maxLength={MAX_COLLECTION_NAME_LEN}
        value={name}
        onChange={(e) => onName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSave();
          }
        }}
        style={{ background: "var(--bg)", color: "var(--tan)", border: "1px solid var(--border)", borderRadius: 4, padding: "6px 8px", fontSize: 12, outline: "none" }}
      />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button onClick={onCancel} className="mono" style={ghostBtn}>
          cancel
        </button>
        <button onClick={onSave} disabled={off} className="mono" style={{ ...primaryBtn, cursor: off ? "default" : "pointer", opacity: off ? 0.6 : 1 }}>
          {pending ? "saving…" : "save"}
        </button>
      </div>
    </>
  );
}
