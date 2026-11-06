import { useState } from "react";
import { type Collection, MAX_COLLECTION_NAME_LEN } from "../../lib/collectionsApi";
import type { AtlasNode } from "@/types";
import { CollectionBlurb } from "./CollectionBlurb";
import { CollectionDocList } from "./CollectionDocList";
import { ShareLinkButton } from "./ShareLinkButton";
import { ActionButton } from "../ActionButton";
import { InlineRenameInput } from "../InlineRenameInput";
import { formatCardDate } from "../../lib/timeAgo";

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
          <InlineRenameInput
            value={draft}
            maxLength={MAX_COLLECTION_NAME_LEN}
            className="min-w-0"
            onChange={setDraft}
            onSubmit={submitRename}
            onCancel={() => {
              setDraft(collection.name);
              setEditing(false);
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
          {formatCardDate(collection.updatedAt)}
        </p>
      </div>

      <p className="text-xs text-tan-3 mb-2">{count} {count === 1 ? "document" : "documents"}</p>
      <CollectionBlurb id={collection.id} updatedAt={collection.updatedAt} />
      <CollectionDocList ids={collection.ids} docs={docs} limit={PREVIEW_COUNT} className="mb-3" />

      <div className="flex gap-2">
        <ActionButton color="var(--accent)" onClick={onOpen}>Open</ActionButton>
        <ActionButton color="var(--tan-3)" onClick={() => setEditing(true)}>Rename</ActionButton>
        <ShareLinkButton id={collection.id} />
        <ActionButton color="var(--error-text)" onClick={onDelete}>Delete</ActionButton>
      </div>
    </article>
  );
}
