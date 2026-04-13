import { useState, useEffect, useTransition } from "react";
import { loadAtlas, type AtlasBundle } from "../lib/docs";

export function useAtlasTree(): AtlasBundle | null {
  const [bundle, setBundle] = useState<AtlasBundle | null>(null);
  const [, startTransition] = useTransition();
  useEffect(() => {
    loadAtlas().then((b) => startTransition(() => setBundle(b)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return bundle;
}
