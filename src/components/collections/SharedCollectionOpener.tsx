import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Link } from "../Link";
import { useSelection } from "../../lib/selection";
import { getSharedCollection } from "../../lib/collectionsApi";
import { track } from "../../lib/analytics";
import { ROUTES } from "../../lib/routes";

// /c/:id — opens a SHARED collection (public read, works logged-out). Fetches the
// collection by id, loads it into the working selection, and hands off to the
// reader's selected-only view. Replaces whatever the viewer had selected.
//
// We set the collection NAME (for the pill) but deliberately NOT the active
// collection ID: the viewer usually isn't the owner, so an in-place "Update"
// would 404. Leaving the id unset makes the save modal offer "save as new"
// instead — the viewer keeps their own copy.
export function SharedCollectionOpener({ id }: { id: string }) {
  const { replace, setActiveCollectionName } = useSelection();
  const [, navigate] = useLocation();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getSharedCollection(id)
      .then((c) => {
        if (!alive) return;
        replace(c.ids);
        setActiveCollectionName(c.name);
        track("collection_open_shared", { id: c.id, count: c.ids.length });
        navigate(`${ROUTES.ATLAS}?subset=selected`, { replace: true });
      })
      .catch(() => alive && setError("This shared collection could not be found."));
    return () => {
      alive = false;
    };
  }, [id, replace, setActiveCollectionName, navigate]);

  return (
    <div className="flex flex-col items-center justify-center flex-1 py-24 gap-3 text-center px-4">
      {error ? (
        <>
          <p className="text-sm mono" style={{ color: "var(--error-text)" }}>
            {error}
          </p>
          <Link to={ROUTES.ATLAS} className="text-xs mono text-accent hover:underline">
            ← back to the atlas
          </Link>
        </>
      ) : (
        <p className="mono text-xs text-tan-3">Opening shared collection…</p>
      )}
    </div>
  );
}
