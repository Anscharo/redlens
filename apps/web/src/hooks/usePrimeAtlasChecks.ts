import { useMemo } from "react";
import { checkAtlasValues, type ValueCheck } from "@/lib/pauAtlasValues";
import type { StoredPauSnapshot } from "@/lib/pau";
import { graphPrimeSources } from "@/lib/pauDocSources";
import { loadGraph } from "../lib/graph";
import { loadAtlas } from "../lib/docs";
import { loadPau, snapshotsForPrime } from "../lib/pau";
import { useLoaded } from "./useAtlasData";

/** Every value the atlas states for the prime's keys, in its instances and in its limit documents, beside the chain (pauAtlasValues.ts); empty until the graph loads. */
export function usePrimeAtlasChecks(primeId: string | undefined, snaps: StoredPauSnapshot[]): ValueCheck[] {
  const graph = useLoaded(loadGraph, { soft: true });
  const atlas = useLoaded(loadAtlas, { soft: true });
  return useMemo(() => {
    const sources = primeId ? graphPrimeSources(primeId, graph, atlas ?? undefined) : null;
    return sources ? checkAtlasValues(sources, snaps) : [];
  }, [graph, atlas, primeId, snaps]);
}

/** The same checks, against the prime's PAU snapshots; empty without a prime, and until the snapshots load. */
export function usePrimeChecks(primeId: string | undefined): ValueCheck[] {
  const res = useLoaded(loadPau, { soft: true });
  const snaps = useMemo(() => (res && primeId ? snapshotsForPrime(res, primeId) : []), [res, primeId]);
  const checks = usePrimeAtlasChecks(primeId, snaps);
  return res ? checks : [];
}
