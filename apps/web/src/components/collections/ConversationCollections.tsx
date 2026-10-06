import { useConversations } from "../../hooks/useConversations";
import { useOpenConversationCollection } from "../../hooks/useOpenConversationCollection";
import { ConversationCollectionCard } from "./ConversationCollectionCard";

// The auto collections: one per conversation that cites at least one doc,
// newest chat first (the list's own order).
export function ConversationCollections() {
  const { conversations, loading, error } = useConversations();
  const { open, failed } = useOpenConversationCollection();

  if (loading) return <p className="mono text-xs text-tan-3">Loading…</p>;
  if (error) {
    return (
      <p className="mono text-xs" style={{ color: "var(--error-text)" }}>
        Failed to load conversations: {error}
      </p>
    );
  }
  const cited = conversations.filter((c) => c.citationCount > 0);
  if (cited.length === 0) {
    return (
      <p className="mono text-xs text-tan-3">
        No collections from conversations yet — they appear here once a chat cites atlas documents.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {failed && (
        <p className="mono text-xs" role="alert" style={{ color: "var(--error-text)" }}>
          Couldn't open that collection. Try again.
        </p>
      )}
      {cited.map((c) => (
        <ConversationCollectionCard key={c.id} conversation={c} onOpen={() => void open(c.id)} />
      ))}
    </div>
  );
}
