import { useLocation } from "wouter";
import { useSelection } from "../../lib/selection";
import { track } from "../../lib/analytics";
import { ROUTES } from "@/lib/routes";
import type { Collection } from "../../lib/collectionsApi";

// Opens one of the user's saved collections in the reader's selected-only view,
// as the owner: its id is the active collection, so Save can Update it.
export function useOpenOwnCollection(): (c: Collection) => void {
  const { replace, setActiveCollectionId, setActiveCollectionName } = useSelection();
  const [, navigate] = useLocation();
  return (c) => {
    replace(c.ids);
    setActiveCollectionId(c.id);
    setActiveCollectionName(c.name);
    track("collection_open", { id: c.id, count: c.ids.length });
    // Carry the selected subset in the destination URL: subset=selected is
    // decoded from the current URL by SelectionProvider, so setting it here
    // (still on /collections) would be dropped by the navigation to /atlas.
    navigate(`${ROUTES.ATLAS}?subset=selected`);
  };
}
