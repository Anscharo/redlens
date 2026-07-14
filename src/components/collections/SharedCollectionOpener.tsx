import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useSelection } from "../../lib/selection";
import { getSharedCollection } from "../../lib/collectionsApi";
import { track } from "../../lib/analytics";
import { ROUTES } from "../../lib/routes";

// /c/:id — opens a SHARED collection (public read, works logged-out). Fetches the
// collection by id, loads it into the working selection, and hands off to the
// reader's selected-only view. Replaces whatever the viewer had selected, same
// as opening one's own collection from /collections.
export function SharedCollectionOpener({ id }: { id: string }) {
  const { replace, setActiveCollectionId, setActiveCollectionName } = useSelection();
  const [, navigate] = useLocation();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getSharedCollection(id)
      .then((c) => {
        if (!alive) return;
        replace(c.ids);
        setActiveCollectionId(c.id);
        setActiveCollectionName(c.name);
        track("collection_open_shared", { id: c.id, count: c.ids.length });
        navigate(`${ROUTES.ATLAS}?selectedOnly=1`, { replace: true });
      })
      .catch(() => alive && setError("This shared collection could not be found."));
    return () => {
      alive = false;
    };
  }, [id, replace, setActiveCollectionId, setActiveCollectionName, navigate]);

  return (
    <div className="flex flex-col items-center justify-center flex-1 py-24 gap-3 text-center px-4">
      {error ? (
        <>
          <p className="text-sm mono" style={{ color: "var(--error-text)" }}>
            {error}
          </p>
          <a href={ROUTES.ATLAS} className="text-xs mono text-accent hover:underline">
            ← back to the atlas
          </a>
        </>
      ) : (
        <p className="mono text-xs text-tan-3">Opening shared collection…</p>
      )}
    </div>
  );
}
