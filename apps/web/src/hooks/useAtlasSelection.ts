import { useState, useEffect, useCallback, startTransition } from "react";
import { useFilterHides } from "../lib/atlasFilter";

// id comes from the url. we double state here because its more performant (noticible faster to human eyes)
// when we update the id state sync (selectedId) and then use a transition to update the url state.
export function useAtlasSelection(id: string, onNavigate: (id: string) => void) {
  const [selectedId, setSelectedId] = useState<string | null>(id);
  const filterHides = useFilterHides();

  // Mirror external URL-driven changes (back/forward, sidebar nav) into local state.
  useEffect(() => { setSelectedId(id); }, [id]);

  // Flip selection optimistically so the CSS class updates in the current frame,
  // then defer the URL update (and its cascade) as a transition. A doc the
  // subset filter hides opens in the comparison pane and the URL id stays put,
  // so selection must not move to it: nothing would move it back.
  const handleNavigate = useCallback((nid: string) => {
    if (!filterHides(nid)) setSelectedId(nid);
    startTransition(() => onNavigate(nid));
  }, [onNavigate, filterHides]);

  return { selectedId, handleNavigate };
}
