import { useEffect, useState } from "react";
import { getCollection } from "../../lib/collectionsApi";

export type Baseline =
  | { status: "none" }
  | { status: "loading" }
  | { status: "ready"; ids: string[] }
  | { status: "error" };

// The docs one of the user's own collections holds on the server right now,
// fetched when the save dialog opens (not captured when the collection was
// opened, which another tab may have since changed). "none" without an id.
export function useCollectionBaseline(id: string | null): Baseline {
  const [loaded, setLoaded] = useState<{ id: string; ids: string[] | null } | null>(null);

  useEffect(() => {
    if (!id) return;
    let live = true;
    getCollection(id).then(
      (c) => live && setLoaded({ id, ids: c.ids }),
      () => live && setLoaded({ id, ids: null }),
    );
    return () => {
      live = false;
    };
  }, [id]);

  if (!id) return { status: "none" };
  if (loaded?.id !== id) return { status: "loading" };
  return loaded.ids ? { status: "ready", ids: loaded.ids } : { status: "error" };
}
