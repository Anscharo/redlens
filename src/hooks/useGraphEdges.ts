import { useState, useEffect } from "react";
import { getEdges, type EdgeResult } from "../lib/graph";

const EMPTY_EDGES: EdgeResult = { outbound: [], inbound: [] };

export function useGraphEdges(id: string): EdgeResult {
  const [graphEdges, setGraphEdges] = useState<EdgeResult>(EMPTY_EDGES);
  useEffect(() => {
    setGraphEdges(EMPTY_EDGES);
    if (!id) return;
    let cancelled = false;
    getEdges(id).then((r) => {
      if (!cancelled) setGraphEdges(r);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);
  return graphEdges;
}
