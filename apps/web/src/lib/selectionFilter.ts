import { useMemo } from "react";
import { useSelection } from "./selection";

// The set of doc ids to show when "selected only" is on. Returns null when
// filtering is off (toggle off or nothing selected) — meaning "show everything".
export function useSelectionSet(): Set<string> | null {
  const { selectedOnly, ids } = useSelection();
  return useMemo(() => {
    if (!selectedOnly || ids.size === 0) return null;
    return ids;
  }, [selectedOnly, ids]);
}
