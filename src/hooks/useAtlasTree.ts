import { useState, useEffect } from "react";
import { loadAtlas, type AtlasBundle } from "../lib/docs";

export function useAtlasTree(): AtlasBundle | null {
  const [bundle, setBundle] = useState<AtlasBundle | null>(null);
  useEffect(() => { loadAtlas().then(setBundle); }, []);
  return bundle;
}
