import { useState, useEffect } from "react";
import { loadDocs } from "../lib/docs";
import type { AtlasNode } from "../types";

let cached: AtlasNode[] | null = null;

export function useScopes() {
  const [scopes, setScopes] = useState<AtlasNode[]>(cached ?? []);

  useEffect(() => {
    if (cached) { setScopes(cached); return; }
    loadDocs().then((docs) => {
      const s = Object.values(docs)
        .filter((n) => n.depth === 1)
        .sort((a, b) => a.order - b.order);
      cached = s;
      setScopes(s);
    });
  }, []);

  return scopes;
}
