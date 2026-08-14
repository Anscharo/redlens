import { useCallback, useRef, useState } from "react";
import { useChatStream } from "./useChatStream";
import { useUsage } from "./useUsage";
import { useRateLimitLock } from "./useRateLimitLock";
import { useAuth } from "./auth";
import { getConversation } from "../../lib/conversationsApi";
import { toChatMsgs } from "./hydrate";

// Composes the chat hooks that used to live inside ChatPanel — useChatStream +
// useUsage + useRateLimitLock — plus conversation-switch orchestration
// (open/new/hydrate). Called from ChatWidget, NOT ChatPanel, so the thread, an
// in-flight stream, and the rate-limit lock all survive minimize/reopen
// instead of being torn down and rebuilt on every panel mount (see the
// chat-conversation-memory plan §5, "lift, don't provide").
//
// `open` gates useUsage's refetch: it must be `authed && open`, not just
// `authed`, to preserve today's "refetch the meter each time the panel opens"
// behavior now that the hook no longer mounts/unmounts with the panel.
export function useChatSession(open: boolean) {
  const { user, openAuth } = useAuth();
  const authed = !!user;

  const { usage, commons, contextWindow, refresh } = useUsage(authed && open);
  const [rateLimit, setRateLimit] = useRateLimitLock(commons, refresh);
  const { messages, streaming, error, conversationId, contextTokens, send, stop, reset, hydrate } = useChatStream({
    onDone: () => void refresh(),
    onAuthError: openAuth,
  });

  const [title, setTitle] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  // Invalidates a stale in-flight openConversation fetch when a newer
  // open/new-chat request supersedes it before the fetch resolves — otherwise
  // a slow GET could land after the user has already moved on and clobber
  // whatever conversation they're looking at now.
  const requestIdRef = useRef(0);

  const newChat = useCallback(() => {
    requestIdRef.current += 1;
    reset();
    setTitle(null);
    setLoadingHistory(false);
  }, [reset]);

  const openConversation = useCallback(
    async (id: string, presetTitle: string | null = null) => {
      const reqId = ++requestIdRef.current;
      setTitle(presetTitle);
      setLoadingHistory(true);
      try {
        const detail = await getConversation(id);
        if (requestIdRef.current !== reqId) return; // superseded — discard
        hydrate(detail.id, toChatMsgs(detail.messages), detail.contextTokens ?? null);
        setTitle(detail.title ?? presetTitle);
      } catch {
        // Never surface a fetch failure as an error banner here — a stale or
        // deleted id isn't something the user did wrong. Fall back to a
        // fresh conversation instead.
        if (requestIdRef.current !== reqId) return;
        hydrate(null, []);
        setTitle(null);
      } finally {
        if (requestIdRef.current === reqId) setLoadingHistory(false);
      }
    },
    [hydrate],
  );

  return {
    authed,
    openAuth,
    messages,
    streaming,
    error,
    send,
    stop,
    conversationId,
    contextTokens,
    usage,
    commons,
    contextWindow,
    refresh,
    rateLimit,
    setRateLimit,
    title,
    loadingHistory,
    newChat,
    openConversation,
  };
}

export type ChatSession = ReturnType<typeof useChatSession>;
