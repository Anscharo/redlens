import { useState } from "react";
import type { Collection } from "../../lib/collectionsApi";
import type { AtlasNode } from "../../types";

const PREVIEW_COUNT = 3;

// Single collection card: name (inline-editable), doc count + preview titles,
// updated date, and Open/Rename/Delete actions.
export function CollectionCard({
  collection,
  docs,
  onOpen,
  onRename,
  onDelete,
}: {
  collection: Collection;
  docs: Record<string, AtlasNode> | null;
  onOpen: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(collection.name);

  const submitRename = () => {
    const trimmed = draft.trim();
    setEditing(false);
    if (trimmed && trimmed !== collection.name) onRename(trimmed);
    else setDraft(collection.name);
  };

  const titles = docs
    ? collection.ids
        .slice(0, PREVIEW_COUNT)
        .map((id) => docs[id]?.title)
        .filter((t): t is string => Boolean(t))
    : [];
  const extra = collection.ids.length - titles.length;

  return (
    <article
      className="px-4 py-4 rounded border"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
    >
      <div className="flex items-start justify-between gap-3 mb-1">
        {editing ? (
          <input
            autoFocus
            className="text-sm font-medium bg-transparent border-b outline-none flex-1"
            style={{ color: "var(--tan)", borderColor: "var(--border)" }}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={submitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitRename();
              if (e.key === "Escape") {
                setDraft(collection.name);
                setEditing(false);
              }
            }}
          />
        ) : (
          <button
            className="text-sm font-medium text-left hover:underline"
            style={{ color: "var(--tan)" }}
            onClick={() => setEditing(true)}
          >
            {collection.name}
          </button>
        )}
        <p className="mono text-[11px] text-tan-3 whitespace-nowrap">
          {new Date(collection.updatedAt).toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
        </p>
      </div>

      <p className="text-xs text-tan-3 mb-3">
        {collection.ids.length} {collection.ids.length === 1 ? "document" : "documents"}
        {titles.length > 0 && <> — {titles.join(", ")}{extra > 0 ? ` +${extra} more` : ""}</>}
      </p>

      <div className="flex gap-2">
        <button
          className="mono text-xs px-3 py-1.5 rounded border transition-colors hover:bg-[var(--hover)]"
          style={{ borderColor: "var(--border)", color: "var(--accent)" }}
          onClick={onOpen}
        >
          Open
        </button>
        <button
          className="mono text-xs px-3 py-1.5 rounded border transition-colors hover:bg-[var(--hover)]"
          style={{ borderColor: "var(--border)", color: "var(--tan-3)" }}
          onClick={() => setEditing(true)}
        >
          Rename
        </button>
        <button
          className="mono text-xs px-3 py-1.5 rounded border transition-colors hover:bg-[var(--hover)]"
          style={{ borderColor: "var(--border)", color: "var(--error-text)" }}
          onClick={onDelete}
        >
          Delete
        </button>
      </div>
    </article>
  );
}
