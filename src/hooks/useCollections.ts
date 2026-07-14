import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../components/chat/auth";
import {
  type Collection,
  listCollections,
  renameCollection,
  deleteCollection,
} from "../lib/collectionsApi";

// Loads + mutates the signed-in user's collections. Mirrors the auth-probe
// style (fetch on mount, tolerate failure, guard against post-unmount sets).
// Refetches whenever the user becomes signed in (collections are auth-gated).
export function useCollections(): {
  collections: Collection[];
  loading: boolean;
  error: string | null;
  rename: (id: string, name: string) => Promise<Collection>;
  remove: (id: string) => Promise<void>;
} {
  const { user } = useAuth();
  const [collections, setCollections] = useState<Collection[]>([]);
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
      setCollections([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    listCollections()
      .then((cs) => {
        if (aliveRef.current) setCollections(cs);
      })
      .catch((err) => {
        if (aliveRef.current) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (aliveRef.current) setLoading(false);
      });
  }, [user]);

  const rename = useCallback(async (id: string, name: string) => {
    const updated = await renameCollection(id, name);
    if (aliveRef.current) {
      setCollections((prev) => prev.map((c) => (c.id === id ? updated : c)));
    }
    return updated;
  }, []);

  const remove = useCallback(async (id: string) => {
    await deleteCollection(id);
    if (aliveRef.current) setCollections((prev) => prev.filter((c) => c.id !== id));
  }, []);

  return { collections, loading, error, rename, remove };
}
