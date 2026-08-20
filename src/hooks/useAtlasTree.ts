import { useState, useEffect, useTransition } from "react";
import { loadAtlas, loadAtlasShallow, type AtlasBundle } from "@/lib/docs";
import { useDataSource } from "@/lib/dataSource";

// Progressive: render the shallow tree (depth ≤ 5) the instant it lands, then
// upgrade to the full bundle so deep nodes (depth > 5) become navigable. Both
// resolve from the same per-base worker, so this adds no extra fetch — it just
// stops blocking the sidebar's first paint on docs-deep.
export function useAtlasTree(): AtlasBundle | null {
  const { base } = useDataSource();
  const [bundle, setBundle] = useState<AtlasBundle | null>(null);
  const [, startTransition] = useTransition();
  useEffect(() => {
    let live = true;
    setBundle(null);
    // Shallow first — but don't clobber a full bundle that already landed.
    loadAtlasShallow(base)
      .then((b) => { if (live) startTransition(() => setBundle((prev) => prev ?? b)); })
      .catch(() => {});
    // Full — replace the shallow set once all depths are merged in.
    loadAtlas(base)
      .then((b) => { if (live) startTransition(() => setBundle(b)); })
      .catch(() => {});
    return () => { live = false; };
  }, [base]);
  return bundle;
}
