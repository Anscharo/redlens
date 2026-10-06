import type { ConversationSummary } from "../../lib/conversationsApi";

const UNTITLED = "Untitled chat";

// One conversation's auto collection. Read-only: it is rebuilt from the chat
// on every open, so there is no rename, delete or share here — manage the chat
// itself on /conversations.
export function ConversationCollectionCard({
  conversation,
  onOpen,
}: {
  conversation: ConversationSummary;
  onOpen: () => void;
}) {
  const n = conversation.citationCount;
  return (
    <article className="px-4 py-4 rounded border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <div className="flex items-start justify-between gap-3 mb-1 min-w-0">
        <h2 className="text-sm font-medium truncate min-w-0" style={{ color: "var(--tan)" }}>
          {conversation.title ?? UNTITLED}
        </h2>
        <p className="mono text-[11px] text-tan-3 whitespace-nowrap shrink-0">
          {new Date(conversation.updatedAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
        </p>
      </div>
      <p className="text-xs text-tan-3 mb-3">
        {n} {n === 1 ? "document" : "documents"} cited
      </p>
      <button
        type="button"
        className="mono text-xs px-3 py-1.5 rounded border transition-colors hover:bg-[var(--hover)]"
        style={{ borderColor: "var(--border)", color: "var(--accent)" }}
        onClick={onOpen}
      >
        Open
      </button>
    </article>
  );
}
