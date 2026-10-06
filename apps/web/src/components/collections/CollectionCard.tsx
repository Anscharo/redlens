import { useState } from "react";
import { type Collection, MAX_COLLECTION_NAME_LEN } from "../../lib/collectionsApi";
import type { AtlasNode } from "@/types";
import { CollectionBlurb } from "./CollectionBlurb";
import { CollectionDocList } from "./CollectionDocList";
import { ShareLinkButton } from "./ShareLinkButton";

const PREVIEW_COUNT = 10;

// Single collection card: name (inline-editable), doc count + a vertical list of
// the first documents (doc_no + title), updated date, and Open/Rename/Delete.
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
  const count = collection.ids.length;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(collection.name);

  const submitRename = () => {
    const trimmed = draft.trim();
    setEditing(false);
    if (trimmed && trimmed !== collection.name) onRename(trimmed);
    else setDraft(collection.name);
  };

  return (
    <article
      className="px-4 py-4 rounded border"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
    >
      <div className="flex items-start justify-between gap-3 mb-1 min-w-0">
        {editing ? (
          <input
            autoFocus
            className="text-sm font-medium bg-transparent border-b outline-none flex-1 min-w-0"
            style={{ color: "var(--tan)", borderColor: "var(--border)" }}
            maxLength={MAX_COLLECTION_NAME_LEN}
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
            className="text-sm font-medium text-left hover:underline truncate min-w-0"
            style={{ color: "var(--tan)" }}
            onClick={() => setEditing(true)}
          >
            {collection.name}
          </button>
        )}
        <p className="mono text-[11px] text-tan-3 whitespace-nowrap shrink-0">
          {new Date(collection.updatedAt).toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
        </p>
      </div>

      <p className="text-xs text-tan-3 mb-2">{count} {count === 1 ? "document" : "documents"}</p>
      <CollectionBlurb id={collection.id} updatedAt={collection.updatedAt} />
      <CollectionDocList ids={collection.ids} docs={docs} limit={PREVIEW_COUNT} className="mb-3" />

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
        <ShareLinkButton id={collection.id} />
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
