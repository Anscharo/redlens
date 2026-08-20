import { useState } from "react";
import { MAX_CONVERSATION_TITLE_LEN, type ConversationSummary } from "@/lib/conversationsApi";
import { formatTokens } from "@/lib/formatTokens";

const UNTITLED = "Untitled chat";

// Bails an outer row handler when the event originated on (or inside) a
// nested interactive element — the rename input, or the Rename/Delete
// buttons — so the row's own open action doesn't also fire. Same
// closest()-based pattern as CollapsibleNode.tsx's row-click handler, with
// one addition: `container` (the row itself) is excluded from the match.
// The row also carries role="button" for keyboard semantics, so a plain
// closest() from a click anywhere in the row (e.g. the title text) would
// match the row's OWN role="button" and false-bail on every click.
function isInteractiveDescendant(target: EventTarget | null, container: Element): boolean {
  if (!(target instanceof Element)) return false;
  const el = target.closest('button, input, a, [role="button"]');
  return !!el && el !== container;
}

// Single conversation row: title (inline-editable), updated date + message
// count, and explicit Rename/Delete buttons. Mirrors CollectionCard, with one
// structural difference — the row itself is the "open" affordance (clicking
// anywhere on it opens the chat widget on this conversation, no navigation),
// so it can't be a plain <button> (Rename/Delete would then be invalid nested
// interactive content). It's an <article role="button"> with tabIndex +
// keyboard support instead, per the conversations-page plan §7.
export function ConversationCard({
  conversation,
  onOpen,
  onRename,
  onDelete,
}: {
  conversation: ConversationSummary;
  onOpen: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(conversation.title ?? "");

  const submitRename = () => {
    const trimmed = draft.trim();
    setEditing(false);
    if (trimmed && trimmed !== conversation.title) onRename(trimmed);
    else setDraft(conversation.title ?? "");
  };

  const openRow = () => {
    if (editing) return;
    onOpen();
  };

  return (
    <article
      role="button"
      tabIndex={0}
      aria-label={`Open conversation: ${conversation.title ?? UNTITLED}`}
      className="px-4 py-4 rounded border text-left w-full cursor-pointer"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      onClick={(e) => {
        if (isInteractiveDescendant(e.target, e.currentTarget)) return;
        openRow();
      }}
      onKeyDown={(e) => {
        if (isInteractiveDescendant(e.target, e.currentTarget)) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openRow();
        }
      }}
    >
      <div className="flex items-start justify-between gap-3 mb-1">
        {editing ? (
          <input
            autoFocus
            className="text-sm font-medium bg-transparent border-b outline-none flex-1"
            style={{ color: "var(--tan)", borderColor: "var(--border)" }}
            maxLength={MAX_CONVERSATION_TITLE_LEN}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={submitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitRename();
              if (e.key === "Escape") {
                setDraft(conversation.title ?? "");
                setEditing(false);
              }
            }}
          />
        ) : (
          <p className="text-sm font-medium truncate" style={{ color: "var(--tan)" }}>
            {conversation.title ?? UNTITLED}
          </p>
        )}
        <p className="mono text-[11px] text-tan-3 whitespace-nowrap">
          {new Date(conversation.updatedAt).toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
        </p>
      </div>

      <p className="text-xs text-tan-3 mb-3">
        {conversation.messageCount} {conversation.messageCount === 1 ? "message" : "messages"}
        {conversation.contextTokens != null &&
          ` · ${conversation.contextEstimated ? "~" : ""}${formatTokens(conversation.contextTokens)} context`}
      </p>

      <div className="flex gap-2">
        <button
          type="button"
          className="mono text-xs px-3 py-1.5 rounded border transition-colors hover:bg-[var(--hover)]"
          style={{ borderColor: "var(--border)", color: "var(--tan-3)" }}
          onClick={() => setEditing(true)}
        >
          Rename
        </button>
        <button
          type="button"
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
