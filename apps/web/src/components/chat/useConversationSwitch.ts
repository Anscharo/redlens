import { useCallback, useRef, useState } from "react";
import { getConversation } from "../../lib/conversationsApi";
import type { ChatMsg } from "./chatTypes";
import { toChatMsgs } from "./hydrate";

interface SwitchTarget {
  hydrate: (id: string | null, msgs: ChatMsg[], contextTokens?: number | null) => void;
  setTitle: (title: string | null) => void;
  setLoadingHistory: (loading: boolean) => void;
  /** False once a newer open/new-chat request has superseded this one. */
  isCurrent: () => boolean;
}

// A superseded request discards its result — a slow GET landing after the
// user has moved on must not clobber the conversation they're looking at
// now. A fetch failure is never surfaced as an error banner: a stale or
// deleted id isn't something the user did wrong, so it falls back to a
// fresh conversation instead.
async function loadConversation(id: string, presetTitle: string | null, t: SwitchTarget): Promise<void> {
  t.setTitle(presetTitle);
  t.setLoadingHistory(true);
  try {
    const detail = await getConversation(id);
    if (!t.isCurrent()) return;
    t.hydrate(detail.id, toChatMsgs(detail.messages), detail.contextTokens ?? null);
    t.setTitle(detail.title ?? presetTitle);
  } catch {
    if (!t.isCurrent()) return;
    t.hydrate(null, []);
    t.setTitle(null);
  } finally {
    if (t.isCurrent()) t.setLoadingHistory(false);
  }
}

// Which conversation the stream shows: open a stored one, or start fresh.
// Each request bumps `requestIdRef`, which is what invalidates an earlier
// in-flight open.
export function useConversationSwitch(hydrate: SwitchTarget["hydrate"], reset: () => void) {
  const [title, setTitle] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
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
      await loadConversation(id, presetTitle, { hydrate, setTitle, setLoadingHistory, isCurrent: () => requestIdRef.current === reqId });
    },
    [hydrate],
  );
  return { title, loadingHistory, newChat, openConversation };
}
