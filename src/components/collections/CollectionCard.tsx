import { useState } from "react";
import { type Collection, MAX_COLLECTION_NAME_LEN } from "../../lib/collectionsApi";
import type { AtlasNode } from "../../types";

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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(collection.name);
  const [copied, setCopied] = useState(false);

  const share = async () => {
    const url = `${window.location.origin}/c/${collection.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy this share link:", url);
    }
  };

  const submitRename = () => {
    const trimmed = draft.trim();
    setEditing(false);
    if (trimmed && trimmed !== collection.name) onRename(trimmed);
    else setDraft(collection.name);
  };

  const items = docs
    ? collection.ids
        .slice(0, PREVIEW_COUNT)
        .map((id) => docs[id])
        .filter((n): n is AtlasNode => Boolean(n))
    : [];
  const extra = collection.ids.length - items.length;

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

      <p className="text-xs text-tan-3 mb-2">
        {collection.ids.length} {collection.ids.length === 1 ? "document" : "documents"}
      </p>
      {items.length > 0 && (
        <ul className="mb-3 flex flex-col gap-0.5">
          {items.map((n) => (
            <li key={n.id} className="text-xs flex gap-2 min-w-0">
              <span className="mono text-tan-3 shrink-0">{n.doc_no}</span>
              <span className="truncate" style={{ color: "var(--tan-2)" }}>{n.title}</span>
            </li>
          ))}
          {extra > 0 && <li className="text-xs text-tan-3">+{extra} more</li>}
        </ul>
      )}

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
          style={{ borderColor: "var(--border)", color: "var(--tan-3)" }}
          onClick={share}
          title="Copy a shareable link (anyone with the link can open it)"
        >
          {copied ? "Copied!" : "Share"}
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
