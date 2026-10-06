import { useEffect, useState } from "react";
import { getCollectionSummary, type CollectionSummary } from "../../lib/collectionsApi";

// What the collection's docs are about, in a few words and a sentence. Written
// on the server once per distinct doc set, so `updatedAt` is the only thing that
// needs to retrigger the read. A failed or empty read shows nothing: the card is
// complete without it.
function useCollectionSummary(id: string, updatedAt: string): CollectionSummary | null {
  const [found, setFound] = useState<{ key: string; summary: CollectionSummary } | null>(null);
  const key = `${id}:${updatedAt}`;
  useEffect(() => {
    let live = true;
    getCollectionSummary(id).then(
      (summary) => live && setFound({ key, summary }),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [id, key]);
  return found?.key === key ? found.summary : null;
}

export function CollectionBlurb({ id, updatedAt }: { id: string; updatedAt: string }) {
  const summary = useCollectionSummary(id, updatedAt);
  if (!summary?.label || !summary.summary) return null;
  return (
    <p className="text-xs text-tan-3 mb-2">
      <span className="mono" style={{ color: "var(--tan)" }}>
        {summary.label}
      </span>
      {" — "}
      {summary.summary}
    </p>
  );
}
