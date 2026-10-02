import { useDeferredValue, useMemo } from "react";
import type { GraphData } from "@/lib/graphData";
import { getRadarSearchIndex, searchRadar, type RadarSearchGroup } from "@/lib/radarSearch";

/** Grouped Radar matches for the query, or null while the query is empty. */
export function useRadarSearch(graph: GraphData, query: string): RadarSearchGroup[] | null {
  const q = useDeferredValue(query);
  return useMemo(
    () => (q.trim() ? searchRadar(getRadarSearchIndex(graph), q) : null),
    [graph, q],
  );
}
