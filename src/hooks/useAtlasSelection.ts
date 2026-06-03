import { useState, useEffect, useCallback, startTransition } from "react";

export function useAtlasSelection(id: string, onNavigate: (id: string) => void) {
  const [selectedId, setSelectedId] = useState<string | null>(id);

  // Mirror external URL-driven changes (back/forward, sidebar nav) into local state.
  useEffect(() => { setSelectedId(id); }, [id]);

  // Flip selection optimistically so the CSS class updates in the current frame,
  // then defer the URL update (and its cascade) as a transition.
  const handleNavigate = useCallback((nid: string) => {
    setSelectedId(nid);
    startTransition(() => onNavigate(nid));
  }, [onNavigate]);

  return { selectedId, handleNavigate };
}
