import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Link } from "../Link";
import { useSelection } from "@/lib/selection";
import { getSharedCollection } from "@/lib/collectionsApi";
import { track } from "@/lib/analytics";
import { ROUTES } from "@/lib/routes";

// /c/:id — opens a SHARED collection (public read, works logged-out). Fetches the
// collection by id, loads it into the working selection, and hands off to the
// reader's selected-only view. Replaces whatever the viewer had selected.
//
// We set the collection NAME (for the pill) but explicitly CLEAR the active
// collection ID: the viewer usually isn't the owner, so an in-place "Update"
// would 404 — or worse. This used to just leave the id untouched, trusting it
// was already unset; it usually was, but if the viewer had one of their OWN
// collections active first, that real id was still sitting in
// activeCollectionId. replace() alone doesn't clear it, and — when the shared
// collection happens to be empty — selection.tsx's empties-effect bails out
// too (the openedFromReplaceRef guard that keeps C4 fixed), so nothing else
// would clear it either. The id and name would then diverge: the pill shows
// this shared collection's name, but Save's "Update" would silently PATCH the
// viewer's own previous collection — with this collection's ids, which can be
// `[]`. Explicitly nulling it here (unconditionally, whether or not this
// shared collection is empty) is what guarantees the save modal falls back to
// "save as new" and the viewer's own collection is left alone. (P1 data-loss
// bug, PR #230 review, 2026-08-03.)
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
        setActiveCollectionId(null);
        setActiveCollectionName(c.name);
        track("collection_open_shared", { id: c.id, count: c.ids.length });
        navigate(`${ROUTES.ATLAS}?subset=selected`, { replace: true });
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
