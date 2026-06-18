import { useState, useEffect } from "react";
import { getEdges, type EdgeResult } from "../lib/graph";
import { useDataSource } from "../lib/dataSource";

const EMPTY_EDGES: EdgeResult = { outbound: [], inbound: [] };

export function useGraphEdges(id: string): EdgeResult {
  // The graph worker is a main-only singleton (not yet keyed per data source),
  // so the right-panel graph-relations section is disabled in preview — querying
  // main's graph for preview node ids would be wrong. RightPanel renders nothing
  // for empty edges, so this simply hides the section. (Keying the worker is the
  // P1 path to making relations preview-accurate.)
  const { preview } = useDataSource();
  const [graphEdges, setGraphEdges] = useState<EdgeResult>(EMPTY_EDGES);
  useEffect(() => {
    setGraphEdges(EMPTY_EDGES);
    if (!id || preview) return;
    let cancelled = false;
    getEdges(id)
      .then((r) => {
        if (!cancelled) setGraphEdges(r);
      })
      .catch((err) => {
        if (!cancelled) setGraphEdges(EMPTY_EDGES);
        console.warn("graph edges request failed", err);
      });
    return () => {
      cancelled = true;
    };
  }, [id, preview]);
  return graphEdges;
}
