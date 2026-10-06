import type { ConversationSummary } from "../../lib/conversationsApi";
import { ShareLinkButton } from "./ShareLinkButton";

const UNTITLED = "Untitled chat";

function CardHead({ title, updatedAt }: { title: string | null; updatedAt: string }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-1 min-w-0">
      <h2 className="text-sm font-medium truncate min-w-0" style={{ color: "var(--tan)" }}>
        {title ?? UNTITLED}
      </h2>
      <p className="mono text-[11px] text-tan-3 whitespace-nowrap shrink-0">
        {new Date(updatedAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
      </p>
    </div>
  );
}

// One conversation's auto collection. Read-only: it is rebuilt from the chat
// on every open, so there is no rename or delete here — manage the chat itself
// on /conversations. Share copies /c/<conversation id>.
export function ConversationCollectionCard({ conversation, onOpen }: { conversation: ConversationSummary; onOpen: () => void }) {
  const n = conversation.citationCount;
  return (
    <article className="px-4 py-4 rounded border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <CardHead title={conversation.title} updatedAt={conversation.updatedAt} />
      <p className="text-xs text-tan-3 mb-3">
        {n} {n === 1 ? "document" : "documents"} cited
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          className="mono text-xs px-3 py-1.5 rounded border transition-colors hover:bg-[var(--hover)]"
          style={{ borderColor: "var(--border)", color: "var(--accent)" }}
          onClick={onOpen}
        >
          Open
        </button>
        <ShareLinkButton id={conversation.id} />
      </div>
    </article>
  );
}
