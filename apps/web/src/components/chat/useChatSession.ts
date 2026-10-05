import { useChatStream } from "./useChatStream";
import { useUsage } from "./useUsage";
import { useRateLimitLock } from "./useRateLimitLock";
import { useAuth } from "./auth";
import { useConversationSwitch } from "./useConversationSwitch";

// Composes the chat hooks — useChatStream + useUsage + useRateLimitLock —
// plus conversation switching (open/new/hydrate). Called from ChatWidget, NOT
// ChatPanel, so the thread, an in-flight stream, and the rate-limit lock all
// survive minimize/reopen instead of being torn down and rebuilt on every
// panel mount.
//
// `open` gates useUsage's refetch: it is `authed && open`, not just `authed`,
// so the meter refetches each time the panel opens even though the hook
// itself stays mounted.
export function useChatSession(open: boolean) {
  const { user, openAuth } = useAuth();
  const authed = !!user;
  const { usage, commons, contextWindow, refresh } = useUsage(authed && open);
  const [rateLimit, setRateLimit] = useRateLimitLock(commons, refresh);
  const { messages, streaming, error, conversationId, contextTokens, send, stop, reset, hydrate } = useChatStream({
    onDone: () => void refresh(),
    onAuthError: openAuth,
  });
  const { title, loadingHistory, newChat, openConversation } = useConversationSwitch(hydrate, reset);
  return {
    authed, openAuth, messages, streaming, error, send, stop, conversationId, contextTokens,
    usage, commons, contextWindow, refresh, rateLimit, setRateLimit,
    title, loadingHistory, newChat, openConversation,
  };
}

export type ChatSession = ReturnType<typeof useChatSession>;
