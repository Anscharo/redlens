import { useState, useEffect, useRef } from "react";
import {
  getConstellationInit,
  constellationQuery,
  constellationCluster,
  type ConstellationInit,
} from "../lib/graph";

export function useConstellationsWorker(query: string, focusAgentId: string | null) {
  const [init, setInit] = useState<ConstellationInit | null>(null);
  const [neighborIds, setNeighborIds] = useState<Set<string> | null>(null);
  const [topId, setTopId] = useState<string | null>(null);
  const [clusterIds, setClusterIds] = useState<Set<string> | null>(null);
  const queryIdRef = useRef(0);

  useEffect(() => {
    getConstellationInit().then(setInit);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setNeighborIds(null);
      setTopId(null);
      return;
    }
    const id = ++queryIdRef.current;
    const timer = setTimeout(() => {
      constellationQuery(id, q)
        .then((result) => {
          if (id !== queryIdRef.current) return;
          setNeighborIds(new Set(result.neighborIds));
          setTopId(result.topId);
        })
        .catch((err) => console.warn("constellation query failed", err));
    }, 150);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!focusAgentId) { setClusterIds(null); return; }
    constellationCluster(focusAgentId)
      .then((ids) => setClusterIds(new Set(ids)))
      .catch((err) => console.warn("constellation cluster failed", err));
  }, [focusAgentId]);

  return { init, neighborIds, topId, clusterIds };
}
