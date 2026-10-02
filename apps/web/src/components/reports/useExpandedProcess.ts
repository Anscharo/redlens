// The Processes report's expanded row, held in the `expanded` URL param so it
// is bookmarkable and back/forward navigation drives expansion.
import { useEffect } from "react";
import { useSearchParams } from "wouter";

export function useExpandedProcess(loading: boolean): [expandedUuid: string | null, toggle: (uuid: string) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const expandedUuid = searchParams.get("expanded");

  // After rows render, scroll the expanded row into view. Handles both the
  // initial page-load case (when the row didn't exist yet for the browser's
  // own hash-anchor scroll) and subsequent toggles.
  useEffect(() => {
    if (loading || !expandedUuid) return;
    requestAnimationFrame(() => {
      document.getElementById(expandedUuid)?.scrollIntoView({ behavior: "instant" as ScrollBehavior });
    });
  }, [loading, expandedUuid]);

  const toggle = (uuid: string) => {
    const next = expandedUuid === uuid ? null : uuid;
    setSearchParams((prev) => {
      const np = new URLSearchParams(prev);
      if (next) np.set("expanded", next);
      else np.delete("expanded");
      return np;
    });
  };
  return [expandedUuid, toggle];
}
