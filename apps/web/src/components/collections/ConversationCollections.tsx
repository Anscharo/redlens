import { useConversations } from "../../hooks/useConversations";
import { useOpenConversationCollection } from "../../hooks/useOpenConversationCollection";
import { ConversationCollectionCard } from "./ConversationCollectionCard";
import { ListGate, ListNote } from "./ListGate";

const EMPTY = "No collections from conversations yet — they appear here once a chat cites atlas documents.";

// The auto collections: one per conversation that cites at least one doc,
// newest chat first (the list's own order).
export function ConversationCollections() {
  const { conversations, loading, error } = useConversations();
  const { open, failed } = useOpenConversationCollection();
  const cited = conversations.filter((c) => c.citationCount > 0);

  return (
    <ListGate loading={loading} error={error} errorPrefix="Failed to load conversations" empty={cited.length === 0 ? EMPTY : null}>
      <div className="space-y-3">
        {failed && (
          <ListNote error role="alert">
            Couldn't open that collection. Try again.
          </ListNote>
        )}
        {cited.map((c) => (
          <ConversationCollectionCard key={c.id} conversation={c} onOpen={() => void open(c.id)} />
        ))}
      </div>
    </ListGate>
  );
}
