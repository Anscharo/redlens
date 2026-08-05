import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../components/chat/auth";
import {
  type ConversationSummary,
  listConversations,
  renameConversation,
  deleteConversation,
} from "../lib/conversationsApi";

// Loads + mutates the signed-in user's conversation list. Mirrors
// useCollections.ts: fetch-on-mount, tolerate failure, aliveRef guard against
// post-unmount setState, refetch whenever `user` changes (conversations are
// auth-gated).
//
// rename() returns void, unlike useCollections' rename() (which returns the
// full updated row) — the PATCH response here omits `messageCount` (see
// conversationsApi.ts), and React does not guarantee a functional setState
// updater has run by the time the setter call returns, so there is no safe
// way to hand back a "merged" value synchronously. Nothing needs it: the
// CollectionCard precedent (`onRename: (name: string) => void`) already
// discards the return value.
export function useConversations(): {
  conversations: ConversationSummary[];
  loading: boolean;
  error: string | null;
  rename: (id: string, title: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
} {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!user) {
      setConversations([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    listConversations()
      .then((cs) => {
        if (aliveRef.current) setConversations(cs);
      })
      .catch((err) => {
        if (aliveRef.current) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (aliveRef.current) setLoading(false);
      });
  }, [user]);

  const rename = useCallback(async (id: string, title: string) => {
    const updated = await renameConversation(id, title);
    if (aliveRef.current) {
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, title: updated.title, updatedAt: updated.updatedAt } : c)),
      );
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    await deleteConversation(id);
    if (aliveRef.current) setConversations((prev) => prev.filter((c) => c.id !== id));
  }, []);

  return { conversations, loading, error, rename, remove };
}
