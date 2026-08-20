import { useAuth } from "../chat/auth";
import { SignInButtons } from "../chat/SignInButtons";
import { useConversations } from "../../hooks/useConversations";
import { useChatOpen } from "../../lib/chatOpen";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { track } from "../../lib/analytics";
import type { ConversationSummary } from "../../lib/conversationsApi";
import { ConversationCard } from "./ConversationCard";

// /conversations — a signed-in user's chat history. Sign-in gated (this app
// has no route-level auth gate; every page gates itself, per CollectionsPage
// precedent). Rows don't navigate: clicking one calls openChat() from the
// cross-route chatOpen channel, which the (unconditionally-mounted)
// ChatWidget picks up and hydrates — the user stays on this page and can
// open another conversation right after.
export function ConversationsPage() {
  useDocumentTitle("Conversations");
  const { user } = useAuth();
  const { conversations, loading, error, rename, remove } = useConversations();
  const { openChat, notifyDeleted } = useChatOpen();

  const open = (c: ConversationSummary) => {
    openChat(c.id, c.title);
    track("chat_conversation_open", { id: c.id, message_count: c.messageCount });
  };

  const renameConversation = async (c: ConversationSummary, title: string) => {
    await rename(c.id, title);
    track("chat_conversation_rename", { id: c.id });
  };

  const deleteConversation = async (c: ConversationSummary) => {
    if (!window.confirm(`Delete this conversation${c.title ? ` "${c.title}"` : ""}? This can't be undone.`)) return;
    await remove(c.id);
    // Tell the widget, in case it's currently sitting on this conversation.
    notifyDeleted(c.id);
    track("chat_conversation_delete", { id: c.id });
  };

  return (
    <div className="px-6 py-8">
      <div className="max-w-2xl mx-auto">
        <p className="mono text-xs text-tan-3 mb-1">conversations</p>
        <h1 className="text-xl font-semibold mb-6" style={{ color: "var(--tan)" }}>
          Your Conversations
        </h1>

        {!user ? (
          <div className="flex flex-col items-center gap-4 py-16 text-center">
            <h2 className="text-sm font-medium" style={{ color: "var(--tan)" }}>
              Sign in to view your conversations
            </h2>
            <div className="w-64">
              <SignInButtons variant="menu" source="conversations" />
            </div>
          </div>
        ) : loading ? (
          <p className="mono text-xs text-tan-3">Loading…</p>
        ) : error ? (
          <p className="mono text-xs" style={{ color: "var(--error-text)" }}>
            Failed to load conversations: {error}
          </p>
        ) : conversations.length === 0 ? (
          <p className="mono text-xs text-tan-3">
            No conversations yet — start a chat and it'll show up here.
          </p>
        ) : (
          <div className="space-y-3">
            {conversations.map((c) => (
              <ConversationCard
                key={c.id}
                conversation={c}
                onOpen={() => open(c)}
                onRename={(title) => renameConversation(c, title)}
                onDelete={() => deleteConversation(c)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
