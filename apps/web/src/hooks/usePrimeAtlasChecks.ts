import { useMemo } from "react";
import { checkAtlasValues, type ValueCheck } from "@/lib/pauAtlasValues";
import type { StoredPauSnapshot } from "@/lib/pau";
import { graphPrimeSources } from "@/lib/pauDocSources";
import { loadGraph } from "../lib/graph";
import { loadAtlas } from "../lib/docs";
import { loadPau, snapshotsForPrime } from "../lib/pau";
import { useLoaded } from "./useAtlasData";
import { checkAtlasAddresses } from "@/lib/pauAddressChecks";
import { indexParamChecks } from "../lib/paramChecks";
import type { CardMarks } from "../lib/rowMark";

/** Every value the atlas states for the prime's keys, in its instances and in its limit documents, beside the chain (pauAtlasValues.ts); empty until the graph loads. */
export function usePrimeAtlasChecks(primeId: string | undefined, snaps: StoredPauSnapshot[]): ValueCheck[] {
  const graph = useLoaded(loadGraph, { soft: true });
  const atlas = useLoaded(loadAtlas, { soft: true });
  return useMemo(() => {
    const sources = primeId ? graphPrimeSources(primeId, graph, atlas ?? undefined) : null;
    return sources ? checkAtlasValues(sources, snaps) : [];
  }, [graph, atlas, primeId, snaps]);
}

/** Every check an instance card shows for the prime: its values against the contract, and its IDs and addresses against the snapshots; null without a prime, and until the snapshots and graph load. */
export function usePrimeCardMarks(primeId: string | undefined): CardMarks | null {
  const res = useLoaded(loadPau, { soft: true });
  const graph = useLoaded(loadGraph, { soft: true });
  const atlas = useLoaded(loadAtlas, { soft: true });
  return useMemo(() => {
    const sources = res && primeId ? graphPrimeSources(primeId, graph, atlas ?? undefined) : null;
    if (!res || !primeId || !sources) return null;
    const snaps = snapshotsForPrime(res, primeId);
    return { values: indexParamChecks(checkAtlasValues(sources, snaps)), addresses: checkAtlasAddresses(sources, snaps) };
  }, [res, graph, atlas, primeId]);
}
