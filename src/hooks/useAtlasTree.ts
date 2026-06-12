import { useState, useEffect, useTransition } from "react";
import { loadAtlas, type AtlasBundle } from "../lib/docs";
import { useDataSource } from "../lib/dataSource";

export function useAtlasTree(): AtlasBundle | null {
  const { base } = useDataSource();
  const [bundle, setBundle] = useState<AtlasBundle | null>(null);
  const [, startTransition] = useTransition();
  useEffect(() => {
    setBundle(null);
    loadAtlas(base).then((b) => startTransition(() => setBundle(b)));
  }, [base]);
  return bundle;
}
