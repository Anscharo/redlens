import { useState, useEffect } from "react";
import type { AtlasNode } from "../types";

let cached: AtlasNode[] | null = null;

export function useScopes() {
  const [scopes, setScopes] = useState<AtlasNode[]>(cached ?? []);

  useEffect(() => {
    if (cached) { setScopes(cached); return; }
    fetch("/docs.json")
      .then((r) => r.json())
      .then((docs: Record<string, AtlasNode>) => {
        const s = Object.values(docs)
          .filter((n) => n.depth === 1)
          .sort((a, b) => a.order - b.order);
        cached = s;
        setScopes(s);
      });
  }, []);

  return scopes;
}
